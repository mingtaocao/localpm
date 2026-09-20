import i18n, { resources } from "./index";
export function editorPhrases(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(resources["en-US"].translation)
      .filter((key) => key.startsWith("cm."))
      .map((key) => [key.slice(3), i18n.t(key)]),
  );
}
