import { describe, expect, it } from "vitest";
import { parsePairPaste } from "./pastePairs";
import { platformShortcut } from "./shortcuts";

describe("bulk key/value paste", () => {
  it("preserves duplicates, empty values, templates and equals signs inside values", () => {
    expect(
      parsePairPaste(
        "tag=one\r\ntag=two\r\nempty=\r\ntoken={{token}}\r\nnext=https://example.test/?a=b",
        "params",
      ),
    ).toEqual([
      { key: "tag", value: "one" },
      { key: "tag", value: "two" },
      { key: "empty", value: "" },
      { key: "token", value: "{{token}}" },
      { key: "next", value: "https://example.test/?a=b" },
    ]);
  });
  it("splits headers on the first colon and keeps empty and duplicate headers", () => {
    expect(
      parsePairPaste(
        "X-Time: 12:30:00\nX-Empty:\nX-Tag: a\nX-Tag: b",
        "headers",
      ),
    ).toEqual([
      { key: "X-Time", value: "12:30:00" },
      { key: "X-Empty", value: "" },
      { key: "X-Tag", value: "a" },
      { key: "X-Tag", value: "b" },
    ]);
  });
  it("supports spreadsheet rows and encoded query strings without losing values", () => {
    expect(parsePairPaste("name\t中文\tnote\nblank\t\t", "params")).toEqual([
      { key: "name", value: "中文", description: "note" },
      { key: "blank", value: "", description: "" },
    ]);
    expect(
      parsePairPaste("?tag=a&tag=b&token=%7B%7Btoken%7D%7D&empty=", "params"),
    ).toEqual([
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
      { key: "token", value: "{{token}}" },
      { key: "empty", value: "" },
    ]);
  });
  it("leaves ordinary and partly unrecognized paste untouched", () => {
    for (const text of ["single", "X: one", "a=1\ninvalid", "a\tb\tc\td\nx\ty"])
      expect(parsePairPaste(text, "params")).toBeNull();
    expect(parsePairPaste("https://example.test?a=b&x=y", "params")).toBeNull();
  });
});

it("shows platform-accurate modifier names", () => {
  expect(platformShortcut("S", "MacIntel")).toBe("⌘S");
  expect(platformShortcut("K", "Win32")).toBe("Ctrl+K");
  expect(platformShortcut("Shift+F", "Linux x86_64")).toBe("Ctrl+Shift+F");
});
