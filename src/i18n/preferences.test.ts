import { describe, expect, it } from "vitest";
import i18n, { resolveLanguage, resources } from "./index";
import { normalizeTheme, resolveTheme } from "../stores/preferences";
import { formatError } from "./errors";
import { editorPhrases } from "./editor";

describe("locale and theme preferences", () => {
  it("follows the system until explicitly overridden, including unsupported locales", () => {
    expect(resolveLanguage(undefined, ["zh-CN"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["de-DE", "zh-CN"])).toBe("en-US");
    expect(resolveLanguage("system", [])).toBe("en-US");
    expect(resolveLanguage("en-US", ["zh-CN"])).toBe("en-US");
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLanguage("invalid", ["zh-CN"])).toBe("zh-CN");
  });
  it("resolves all themes and safely defaults old or invalid settings", () => {
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme("invalid")).toBe("system");
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("keeps translation keys and interpolation parameters consistent", () => {
    const en = resources["en-US"].translation;
    const zh = resources["zh-CN"].translation;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      const translated = zh[key as keyof typeof zh];
      expect(translated.trim().length, key).toBeGreaterThan(0);
      expect(translated.match(/%\{[^}]+\}/g) ?? [], key).toEqual(
        value.match(/%\{[^}]+\}/g) ?? [],
      );
    }
  });
  it("translates UI and errors without interpolating HTTP variables or changing user names", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("Enter URL or use {{host}}/api")).toContain("{{host}}/api");
    expect(i18n.t("%{name} copy", { name: "Header {{token}}" })).toBe(
      "Header {{token}} 副本",
    );
    expect(i18n.t("openRequests", { count: 2 })).toBe("2 个打开的请求");
    expect(formatError({ code: "REQUEST_TIMEOUT" })).toBe(
      "REQUEST_TIMEOUT: 请求超时。",
    );
    expect(editorPhrases().Find).toBe("查找");
    await i18n.changeLanguage("en-US");
    expect(i18n.t("openRequests", { count: 1 })).toBe("1 open request");
    expect(i18n.t("openRequests", { count: 2 })).toBe("2 open requests");
    expect(editorPhrases().Find).toBe("Find");
  });
});
