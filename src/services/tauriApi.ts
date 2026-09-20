import i18n from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Workspace, RequestSpec, ResponseResult } from "../types";
export const api = {
  bootstrap: () =>
    invoke<{ workspace: Workspace; drafts: RequestSpec[]; history: any[] }>(
      "app_bootstrap",
    ),
  saveWorkspace: (workspace: Workspace) =>
    invoke<Workspace>("save_workspace", { workspace }),
  draft: (id: string, request: RequestSpec | null) =>
    invoke("save_draft", { id, request }),
  send: (request: RequestSpec, executionId: string) =>
    invoke<ResponseResult>("send_request", { request, executionId }),
  cancel: (executionId: string) => invoke("cancel_request", { executionId }),
  preview: (request: RequestSpec) =>
    invoke<any>("preview_request", { request }),
  history: () => invoke<any[]>("get_history"),
  cookies: () => invoke<any[]>("get_cookies"),
  clearCookies: () => invoke("clear_cookies"),
  clearHistory: () => invoke("clear_history"),
  import: async () => {
    const path = await open({
      title: i18n.t("Import Postman data"),
      filters: [{ name: i18n.t("Postman JSON"), extensions: ["json"] }],
    });
    return path ? invoke<Workspace>("import_file", { path }) : null;
  },
  export: async (id: string, kind: string) => {
    const path = await save({
      title: i18n.t("Export Postman data"),
      defaultPath: `${kind}.postman.json`,
      filters: [{ name: i18n.t("JSON"), extensions: ["json"] }],
    });
    if (path) await invoke("export_file", { id, kind, path });
  },
  file: () => open({ multiple: false, title: i18n.t("Select file") }),
  saveResponse: async (source: string) => {
    const path = await save({
      defaultPath: "response.bin",
      title: i18n.t("Save response"),
    });
    if (path) await invoke("save_response", { source, path });
  },
};
