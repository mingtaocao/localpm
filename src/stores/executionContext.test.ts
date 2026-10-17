import { expect, it } from "vitest";
import { executionWorkspace } from "./executionContext";
import { newRequest, pair, type Workspace } from "../types";

it("freezes environment, globals, collection and folder auth without copying unrelated requests", () => {
  const request = newRequest();
  const workspace: Workspace = {
    activeEnvironment: "dev",
    settings: { proxy: { mode: "off" } },
    globals: [{ ...pair(), key: "global", value: "before" }],
    environments: ["dev", "staging"].map((id) => ({
      id,
      name: id,
      variables: [{ ...pair(), key: "host", value: id }],
      settings: {},
      metadata: null,
    })),
    collections: ["collection", "unrelated"].map((id) => ({
      id,
      name: id,
      auth: { type: "noauth" },
      variables: [
        {
          ...pair(),
          key: "token",
          value: "",
          isSecret: true,
          secretRef: "os-reference",
        },
      ],
      metadata: null,
    })),
    items: [
      {
        id: "folder",
        collectionId: "collection",
        parentId: null,
        kind: "folder",
        name: "Folder",
        order: 0,
        auth: { type: "bearer", token: "before" },
        request: null,
        metadata: null,
      },
      {
        id: "item",
        collectionId: "collection",
        parentId: "folder",
        kind: "request",
        name: "Request",
        order: 0,
        auth: { type: "inherit" },
        request,
        metadata: null,
      },
      {
        id: "other",
        collectionId: "collection",
        parentId: null,
        kind: "request",
        name: "Other",
        order: 1,
        auth: { type: "noauth" },
        request: newRequest(),
        metadata: null,
      },
    ],
  };
  const snapshot = executionWorkspace(workspace, request.id);
  workspace.activeEnvironment = "staging";
  workspace.environments[0].variables[0].value = "changed";
  workspace.globals[0].value = "changed";
  workspace.items[0].auth.token = "changed";
  workspace.settings.proxy.mode = "system";
  expect(snapshot.activeEnvironment).toBe("dev");
  expect(snapshot.environments.map((environment) => environment.id)).toEqual([
    "dev",
  ]);
  expect(snapshot.environments[0].variables[0].value).toBe("dev");
  expect(snapshot.globals[0].value).toBe("before");
  expect(snapshot.items.map((item) => item.id)).toEqual(["folder", "item"]);
  expect(snapshot.items[0].auth.token).toBe("before");
  expect(snapshot.settings.proxy.mode).toBe("off");
  expect(snapshot.collections.map((collection) => collection.id)).toEqual([
    "collection",
  ]);
  expect(snapshot.collections[0].variables[0].secretRef).toBe("os-reference");
});
