import type { ResponseResult } from "../../types";
import type { EditorLanguage } from "./editorExtensions";

const MAX_FORMAT_CHARACTERS = 5 * 1024 * 1024;
export function responsePresentation(
  response: ResponseResult | undefined,
  format: string,
): {
  value: string;
  language: EditorLanguage;
  invalidJson: boolean;
} {
  const body = response?.body ?? "";
  if (format !== "Pretty")
    return { value: body, language: "text", invalidJson: false };
  const contentType = response?.contentType.toLowerCase() ?? "";
  const jsonType = contentType.includes("json");
  if (
    (jsonType || ["{", "["].includes(body.trimStart()[0])) &&
    body.length <= MAX_FORMAT_CHARACTERS
  ) {
    try {
      return {
        value: JSON.stringify(JSON.parse(body), null, 2),
        language: "json",
        invalidJson: false,
      };
    } catch {
      return {
        value: body,
        language: jsonType ? "json" : "text",
        invalidJson: jsonType && !!body.trim(),
      };
    }
  }
  return {
    value: body,
    language: contentType.includes("html")
      ? "html"
      : contentType.includes("xml")
        ? "xml"
        : "text",
    invalidJson: false,
  };
}
