import { describe, expect, it } from "vitest";
import { newRequest, pair, type Workspace } from "../types";
import {
  inheritedAuthorization,
  inheritedSetting,
  urlVariableReferences,
} from "./uiContext";

function fixture() {
  const request = {
    ...newRequest(),
    id: "request",
    url: "{{base}}/{{token}}/{{missing}}",
  };
  const workspace: Workspace = {
    collections: [
      {
        id: "collection",
        name: "API",
        auth: { type: "basic" },
        variables: [{ ...pair(), key: "base", value: "collection" }],
        metadata: null,
      },
    ],
    items: [
      {
        id: "folder",
        collectionId: "collection",
        parentId: null,
        kind: "folder",
        name: "Users",
        order: 0,
        auth: { type: "bearer", token: "never expose" },
        request: null,
        metadata: null,
      },
      {
        id: "item",
        collectionId: "collection",
        parentId: "folder",
        kind: "request",
        name: "Request",
        order: 1,
        auth: { type: "inherit" },
        request,
        metadata: null,
      },
    ],
    environments: [
      {
        id: "dev",
        name: "DEV",
        variables: [
          { ...pair(), key: "base", value: "https://{{host}}" },
          { ...pair(), key: "host", value: "example.test" },
          { ...pair(), key: "token", value: "private", isSecret: true },
        ],
        settings: {},
        metadata: null,
      },
    ],
    activeEnvironment: "dev",
    globals: [
      { ...pair(), key: "base", value: "global" },
      { ...pair(), key: "unused", value: "unused" },
    ],
    settings: {},
  };
  return { request, workspace };
}

describe("UI configuration provenance", () => {
  it("follows network precedence, skipping null and inherited proxies while preserving false", () => {
    const layers = [
      {
        name: "DEV",
        settings: {
          timeout: null,
          verifyTls: false,
          proxy: { mode: "inherit" },
        },
      },
      {
        name: "Global",
        settings: {
          timeout: 45000,
          proxy: { mode: "manual", url: "http://localhost" },
        },
      },
    ];
    expect(inheritedSetting(layers, "timeout")).toEqual({
      value: 45000,
      source: "Global",
    });
    expect(inheritedSetting(layers, "verifyTls")).toEqual({
      value: false,
      source: "DEV",
    });
    expect(inheritedSetting(layers, "proxy").value.mode).toBe("manual");
    expect(inheritedSetting([], "followRedirect")).toEqual({
      value: true,
      source: undefined,
    });
  });
  it("identifies the nearest authorization source without returning credentials, and terminates cycles", () => {
    const { request, workspace } = fixture();
    expect(inheritedAuthorization(workspace, request)).toEqual({
      type: "bearer",
      source: "Users",
    });
    workspace.items[0].auth = { type: "inherit" };
    workspace.items[0].parentId = "folder";
    expect(inheritedAuthorization(workspace, request)).toEqual({
      type: "basic",
      source: "API",
    });
    workspace.items = [];
    expect(inheritedAuthorization(workspace, request)).toEqual({
      type: "noauth",
      source: undefined,
    });
  });
  it("shows only referenced URL variables, respecting overrides, nesting, disabled values and masking", () => {
    const { request, workspace } = fixture();
    workspace.environments[0].variables.push({
      ...pair(),
      key: "base",
      value: "disabled",
      enabled: false,
    });
    expect(urlVariableReferences(workspace, request)).toEqual([
      {
        key: "base",
        value: "https://example.test",
        scope: "Environment",
        source: "DEV",
        valid: true,
      },
      {
        key: "token",
        value: "••••••••",
        scope: "Environment",
        source: "DEV",
        valid: true,
      },
      {
        key: "missing",
        value: "",
        scope: undefined,
        source: undefined,
        valid: false,
      },
    ]);
    request.url = "{{base}}/{{base}}";
    workspace.environments[0].variables[1].value = "{{token}}";
    expect(urlVariableReferences(workspace, request)[0].value).toBe(
      "https://••••••••",
    );
    workspace.environments[0].variables[2].isSecret = false;
    workspace.environments[0].variables[2].secretRef = "credential-id";
    expect(
      JSON.stringify(urlVariableReferences(workspace, request)),
    ).not.toContain("private");
  });
  it("reports cyclic and nested unresolved values without hanging or displaying partial credentials", () => {
    const { request, workspace } = fixture();
    request.url = "{{base}}";
    workspace.environments[0].variables[1].value = "{{base}}";
    expect(urlVariableReferences(workspace, request)[0].valid).toBe(false);
    workspace.environments[0].variables[1].value = "{{unknown}}";
    expect(urlVariableReferences(workspace, request)[0].valid).toBe(false);
  });
});
