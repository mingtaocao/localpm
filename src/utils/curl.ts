import type { Pair, RequestSpec } from "../types";

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function enabled(rows: Pair[]): Pair[] {
  return rows.filter((row) => row.enabled && row.key);
}

export function requestToCurl(request: RequestSpec): string {
  const parts = ["curl", "-X", request.method.toUpperCase(), quote(request.url)];
  for (const header of enabled(request.headers)) {
    parts.push("-H", quote(`${header.key}: ${header.value}`));
  }
  if (request.body?.mode === "raw" && request.body.raw) {
    parts.push("--data-raw", quote(request.body.raw));
  } else if (request.body?.mode === "urlencoded") {
    for (const field of request.body.urlencoded ?? []) {
      if (!field.disabled && field.key) {
        parts.push("--data-urlencode", quote(`${field.key}=${field.value ?? ""}`));
      }
    }
  }
  return parts.join(" ");
}
