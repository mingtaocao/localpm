import { describe, expect, it } from "vitest";
import { newRequest } from "../types";
import { requestToCurl } from "./curl";

describe("requestToCurl", () => {
  it("exports method, URL, enabled headers and raw body", () => {
    const request = {
      ...newRequest(),
      method: "POST",
      url: "https://example.test/items?q={{query}}",
      headers: [
        { key: "Content-Type", value: "application/json", enabled: true, description: "" },
        { key: "Disabled", value: "ignored", enabled: false, description: "" },
      ],
      body: { mode: "raw", raw: '{"name":"O\'Reilly"}' },
    };
    expect(requestToCurl(request)).toBe(
      "curl -X POST 'https://example.test/items?q={{query}}' -H 'Content-Type: application/json' --data-raw '{\"name\":\"O'\\''Reilly\"}'",
    );
  });

  it("exports enabled URL encoded fields", () => {
    const request = {
      ...newRequest(),
      method: "POST",
      url: "https://example.test/form",
      body: {
        mode: "urlencoded",
        urlencoded: [
          { key: "enabled", value: "yes" },
          { key: "disabled", value: "no", disabled: true },
        ],
      },
    };
    expect(requestToCurl(request)).toContain("--data-urlencode 'enabled=yes'");
    expect(requestToCurl(request)).not.toContain("disabled=no");
  });
});
