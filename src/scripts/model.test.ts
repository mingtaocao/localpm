import { describe, it, expect } from "vitest";
import {
  mergeVariableUpdates,
  requestScripts,
  type VariableUpdate,
} from "./model";
import { newRequest, type Workspace } from "../types";
const workspace = (): Workspace => ({
  collections: [],
  items: [],
  globals: [],
  environments: [
    { id: "dev", name: "Dev", variables: [], settings: {}, metadata: null },
    { id: "prod", name: "Prod", variables: [], settings: {}, metadata: null },
  ],
  activeEnvironment: "prod",
  settings: {},
});
const update = (
  key: string,
  revision: number,
  value: string,
): VariableUpdate => ({
  scope: "environment",
  id: "dev",
  key,
  revision,
  pair: { key, value, enabled: true, description: "" },
});
describe("script variables", () => {
  it("merges out-of-order updates per key into the execution environment", () => {
    let ws = workspace();
    ws = mergeVariableUpdates(ws, [update("a", 2, "new")]);
    ws = mergeVariableUpdates(ws, [
      update("b", 1, "other"),
      update("a", 1, "old"),
    ]);
    expect(ws.activeEnvironment).toBe("prod");
    expect(ws.environments[1].variables).toEqual([]);
    expect(ws.environments[0].variables.map((p) => p.value)).toEqual([
      "new",
      "other",
    ]);
    expect(mergeVariableUpdates(ws, [update("a", 2, "new")])).toBe(ws);
  });
  it("applies deletions without losing unrelated variables", () => {
    let ws = mergeVariableUpdates(workspace(), [
      update("a", 1, "a"),
      update("b", 1, "b"),
    ]);
    ws = mergeVariableUpdates(ws, [{ ...update("a", 2, ""), pair: null }]);
    expect(ws.environments[0].variables.map((p) => p.key)).toEqual(["b"]);
  });
  it("keeps imported scripts disabled and prefers edited request scripts", () => {
    const request = newRequest();
    const item = {
      event: [
        {
          listen: "test",
          script: {
            exec: [
              "const data = pm.response.json();",
              "pm.environment.set('id',data.id);",
            ],
          },
        },
      ],
    };
    expect(requestScripts(request, item)).toEqual({
      enabled: false,
      preRequest: "",
      postResponse:
        "const data = pm.response.json();\npm.environment.set('id',data.id);",
    });
    expect(requestScripts(request, item, true).enabled).toBe(true);
    request.metadata = {
      localpmScripts: { enabled: true, preRequest: "", postResponse: "edited" },
    };
    expect(requestScripts(request, item).postResponse).toBe("edited");
    request.metadata.localpmScripts.enabled = false;
    expect(requestScripts(request, item, true).enabled).toBe(false);
  });
});
