import { create } from "zustand";
import { layoutNumber, saveLayout } from "./layout";

const key = "localpm-editor-font-size";
export const useEditorPreferences = create<{
  fontSize: number;
  setFontSize: (size: number) => void;
}>((set) => ({
  fontSize: Math.min(20, Math.max(12, layoutNumber(key, 14))),
  setFontSize: (size) => {
    const fontSize = Math.min(20, Math.max(12, size));
    saveLayout(key, String(fontSize));
    set({ fontSize });
  },
}));
