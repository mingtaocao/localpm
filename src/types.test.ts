import { describe, it, expect } from "vitest";
import { newRequest, paramsFromUrl, urlFromParams, pair } from "./types";
describe("Request editing", () => {
  it("creates independent request identities", () => {
    expect(newRequest().id).not.toBe(newRequest().id);
  });
  it("parses encoded and repeated query parameters", () => {
    expect(
      paramsFromUrl("http://host/?q=a%20b&q=c").map((p) => p.value),
    ).toEqual(["a b", "c"]);
  });
  it("keeps disabled parameters while editing URL", () => {
    const p = { ...pair(), key: "hidden", enabled: false };
    expect(paramsFromUrl("http://host/?a=1", [p])).toContainEqual(p);
  });
  it("synchronizes query and preserves variables and fragment", () => {
    expect(
      urlFromParams("http://{{host}}/x?old=1#fragment", [
        { ...pair(), key: "q", value: "{{term}}" },
      ]),
    ).toBe("http://{{host}}/x?q={{term}}#fragment");
  });
  it("omits disabled query parameters", () => {
    expect(
      urlFromParams("http://host/?x=1", [
        { ...pair(), key: "x", value: "1", enabled: false },
      ]),
    ).toBe("http://host/");
  });
  it("does not erase disabled rows when clearing query", () => {
    expect(
      paramsFromUrl("http://host/", [{ ...pair(), key: "x", enabled: false }]),
    ).toHaveLength(1);
  });
});
