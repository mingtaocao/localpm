import { useEffect, useLayoutEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n, { resolveLanguage } from "../i18n";
import { useWorkspace } from "./workspace";

export type ThemePreference = "light" | "dark" | "system";
export function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolveTheme(
  preference: unknown,
  darkSystem: boolean,
): "light" | "dark" {
  const theme = normalizeTheme(preference);
  return theme === "system" ? (darkSystem ? "dark" : "light") : theme;
}
export function usePreferences() {
  const settings = useWorkspace((s) => s.workspace?.settings);
  const theme = normalizeTheme(settings?.theme);
  const language = settings?.language ?? "system";
  const [darkSystem, setDarkSystem] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [languages, setLanguages] = useState(() => navigator.languages);
  const resolvedTheme = resolveTheme(theme, darkSystem);
  const resolvedLanguage = resolveLanguage(language, languages);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDarkSystem(media.matches);
    const updateLanguage = () => setLanguages([...navigator.languages]);
    media.addEventListener("change", update);
    window.addEventListener("languagechange", updateLanguage);
    update();
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("languagechange", updateLanguage);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = resolvedLanguage;
    void i18n.changeLanguage(resolvedLanguage);
  }, [resolvedTheme, resolvedLanguage]);
  useEffect(() => {
    if (isTauri()) {
      void getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .catch((e) => {
          useWorkspace.setState({ error: String(e) });
        });
    }
  }, [theme]);
  return { theme, language, resolvedTheme };
}
