import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestDrafts } from "./drafts";
import { newRequest, type RequestSpec } from "../types";

afterEach(() => vi.useRealTimers());

describe("request draft persistence", () => {
  it("keeps independent pending edits and coalesces each request to its latest value", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const drafts = new RequestDrafts(write);
    const first = { ...newRequest(), url: "https://first.test/old" };
    const latest = { ...first, url: "https://first.test/new" };
    const second = { ...newRequest(), url: "https://second.test" };
    const callbacks = { started: vi.fn(), saved: vi.fn(), failed: vi.fn() };
    drafts.schedule(first, callbacks);
    await vi.advanceTimersByTimeAsync(200);
    drafts.schedule(second, callbacks);
    drafts.schedule(latest, callbacks);
    await vi.advanceTimersByTimeAsync(500);
    expect(write.mock.calls).toEqual([
      [second.id, second],
      [latest.id, latest],
    ]);
    expect(drafts.get(first.id)).toBe(latest);
  });

  it("serializes late writes and deletion without blocking other requests", async () => {
    const stored = new Map<string, RequestSpec>();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = newRequest();
    const latest = { ...first, url: "https://new.test" };
    const other = newRequest();
    const drafts = new RequestDrafts(async (id, request) => {
      if (request === first) await blocked;
      if (request) stored.set(id, request);
      else stored.delete(id);
    });
    const oldWrite = drafts.save(first);
    const newWrite = drafts.save(latest);
    const deletion = drafts.remove(first.id);
    await drafts.save(other);
    expect(stored.get(other.id)).toBe(other);
    expect(stored.has(first.id)).toBe(false);
    release();
    await Promise.all([oldWrite, newWrite, deletion]);
    expect(stored.has(first.id)).toBe(false);
    expect(drafts.get(first.id)).toBeUndefined();
  });

  it("retains the latest closed draft and permits retry after a failed write", async () => {
    const request = newRequest();
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValue(undefined);
    const drafts = new RequestDrafts(write);
    await expect(drafts.save(request)).rejects.toThrow("Disk full");
    expect(drafts.get(request.id)).toBe(request);
    await drafts.save(request);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("cancels pending autosave when a draft is explicitly removed", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const drafts = new RequestDrafts(write);
    const request = newRequest();
    drafts.schedule(request, {
      started: vi.fn(),
      saved: vi.fn(),
      failed: vi.fn(),
    });
    await drafts.remove(request.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write.mock.calls).toEqual([[request.id, null]]);
  });
});
