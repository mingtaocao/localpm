import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
} from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { linter } from "@codemirror/lint";

export type EditorLanguage = "text" | "json" | "javascript" | "html" | "xml";

export function languageExtensions(
  language: EditorLanguage,
  readOnly: boolean,
) {
  switch (language) {
    case "json":
      return [
        json(),
        ...(readOnly ? [] : [linter(jsonParseLinter(), { delay: 600 })]),
      ];
    case "javascript":
      return [javascript()];
    case "html":
      return [html()];
    case "xml":
      return [xml()];
    default:
      return [];
  }
}

export const sharedExtensions = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  drawSelection({ cursorBlinkRate: 1000 }),
  bracketMatching(),
  foldGutter(),
  indentOnInput(),
  history(),
  search({ top: true }),
  highlightSelectionMatches(),
  EditorState.tabSize.of(2),
  keymap.of([
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...defaultKeymap,
  ]),
];

export function editingExtensions(readOnly: boolean) {
  return [
    EditorState.readOnly.of(readOnly),
    // Read-only documents still need a focusable selection and a visible reading cursor.
    EditorView.editable.of(true),
    ...(readOnly
      ? []
      : [
          closeBrackets(),
          autocompletion(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap]),
        ]),
  ];
}
