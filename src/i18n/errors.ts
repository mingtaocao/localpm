import i18n from "./index";
export function formatError(error: unknown): string {
  if (typeof error === "string" && i18n.exists(error)) return i18n.t(error);
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "ERROR";
  const key = `error.${code}`;
  return `${code}: ${i18n.t(i18n.exists(key) ? key : "Request failed")}`;
}
