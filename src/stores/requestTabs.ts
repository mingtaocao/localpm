import type { RequestSpec, ResponseResult } from "../types";

export type RequestView = {
  requestSection: string;
  responseSection: string;
  responseFormat: string;
  headerSearch: string;
};

export const defaultRequestView: RequestView = {
  requestSection: "Params",
  responseSection: "Pretty",
  responseFormat: "Pretty",
  headerSearch: "",
};

export type RequestTab = {
  request: RequestSpec;
  dirty: boolean;
  response?: ResponseResult;
  responseContext?: { time: string; environment: string; url: string };
  responseIsPrevious?: boolean;
  execution?: string;
  error?: unknown;
  saveState?: "saving" | "draft" | "saved" | "failed";
  view?: RequestView;
};

export function patchRequestView(
  tabs: RequestTab[],
  requestId: string,
  patch: Partial<RequestView>,
): RequestTab[] {
  return tabs.map((tab) =>
    tab.request.id === requestId
      ? { ...tab, view: { ...defaultRequestView, ...tab.view, ...patch } }
      : tab,
  );
}
