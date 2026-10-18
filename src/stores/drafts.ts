import type { RequestSpec } from "../types";

type DraftCallbacks = {
  started: () => void;
  saved: () => void;
  failed: (error: unknown) => void;
};

// Draft lifetime belongs to a request, including while its tab is inactive or closed.
export class RequestDrafts {
  private requests = new Map<string, RequestSpec>();
  private scheduled = new Map<string, RequestSpec>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = new Map<string, Promise<void>>();

  constructor(
    private write: (
      id: string,
      request: RequestSpec | null,
    ) => Promise<unknown>,
    private delay = 500,
  ) {}

  restore(requests: RequestSpec[]) {
    for (const request of requests) {
      this.requests.set(request.id, request);
      this.scheduled.set(request.id, request);
    }
  }

  get(id: string) {
    return this.requests.get(id);
  }

  stage(request: RequestSpec) {
    this.requests.set(request.id, request);
  }

  cancel(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  schedule(request: RequestSpec, callbacks: DraftCallbacks) {
    if (this.scheduled.get(request.id) === request) return;
    this.stage(request);
    this.scheduled.set(request.id, request);
    this.cancel(request.id);
    this.timers.set(
      request.id,
      setTimeout(() => {
        callbacks.started();
        void this.save(request).then(callbacks.saved, callbacks.failed);
      }, this.delay),
    );
  }

  save(request: RequestSpec) {
    this.cancel(request.id);
    this.stage(request);
    this.scheduled.set(request.id, request);
    return this.enqueue(request.id, request);
  }

  remove(id: string) {
    this.cancel(id);
    this.requests.delete(id);
    this.scheduled.delete(id);
    return this.enqueue(id, null);
  }

  dispose() {
    for (const id of this.timers.keys()) {
      this.cancel(id);
      this.scheduled.delete(id);
    }
  }

  private enqueue(id: string, request: RequestSpec | null) {
    // Deletion must follow earlier writes, even when an earlier write failed.
    const operation = (this.writes.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await this.write(id, request);
      });
    this.writes.set(id, operation);
    const cleanup = () => {
      if (this.writes.get(id) === operation) this.writes.delete(id);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }
}
