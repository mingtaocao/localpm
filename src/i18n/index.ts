import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en-US.json";
import zh from "./zh-CN.json";

export type Language = "en-US" | "zh-CN";
export type LanguagePreference = Language | "system";
export function systemLanguage(languages: readonly string[]): Language {
  // Match the preferred system language; unsupported languages fall back to English.
  const first = (languages[0] ?? "").toLowerCase();
  return first === "zh" || first.startsWith("zh-") ? "zh-CN" : "en-US";
}
export function resolveLanguage(
  preference: unknown,
  languages: readonly string[],
): Language {
  return preference === "en-US" || preference === "zh-CN"
    ? preference
    : systemLanguage(languages);
}
export const resources = {
  "en-US": { translation: en },
  "zh-CN": { translation: zh },
};
void i18n.use(initReactI18next).init({
  resources,
  lng: systemLanguage(
    typeof navigator === "undefined" ? [] : navigator.languages,
  ),
  fallbackLng: "en-US",
  supportedLngs: ["en-US", "zh-CN"],
  keySeparator: false,
  nsSeparator: false,
  // Keep HTTP templates such as {{host}} literal in UI hints.
  interpolation: { escapeValue: false, prefix: "%{", suffix: "}" },
  initAsync: false,
});
export default i18n;
