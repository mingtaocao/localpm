import { Compartment, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type EditorSession = {
  state: EditorState;
  configuration: Compartment;
  scrollTop: number;
  scrollLeft: number;
  scroll: ReturnType<EditorView["scrollSnapshot"]>;
  wrap: boolean;
};

// Owned by one workspace, never written to localStorage (documents may contain secrets).
export class EditorSessions {
  private sessions = new Map<string, EditorSession>();

  get(key: string) {
    return this.sessions.get(key);
  }

  set(key: string, session: EditorSession) {
    this.sessions.set(key, session);
  }

  forgetRequest(id: string) {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${id}:`)) this.sessions.delete(key);
    }
  }

  clear() {
    this.sessions.clear();
  }
}
