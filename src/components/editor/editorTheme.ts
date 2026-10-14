import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--editor-keyword)" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--editor-string)",
  },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--editor-number)" },
  { tag: tags.propertyName, color: "var(--editor-property)" },
  { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--error-text)" },
]);

export function editorTheme(dark: boolean) {
  return [
    EditorView.theme(
      {
        "&": {
          color: "var(--text)",
          backgroundColor: "var(--surface)",
          fontSize: "var(--editor-font-size, 14px)",
        },
        ".cm-content": {
          caretColor: "var(--editor-cursor)",
          // drawSelection paints below content; an opaque surface hides the selection.
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
          lineHeight: "1.6",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--editor-cursor)",
          borderLeftWidth: "2px",
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
          {
            backgroundColor: "var(--editor-selection)",
          },
        ".cm-content ::selection, .cm-content::selection": {
          backgroundColor: "transparent",
          color: "var(--text)",
        },
        ".cm-selectionMatch": {
          outline: "1px solid var(--editor-bracket-border)",
          backgroundColor: "var(--editor-bracket-bg)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "var(--editor-active-line)",
        },
        ".cm-gutters": {
          color: "var(--muted)",
          backgroundColor: "var(--surface-raised)",
          borderRight: "1px solid var(--border)",
        },
        "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
          backgroundColor: "var(--editor-bracket-bg)",
          outline: "1px solid var(--editor-bracket-border)",
          color: "var(--text)",
        },
        ".cm-nonmatchingBracket": {
          backgroundColor: "var(--error-bg)",
          outline: "1px solid var(--error-text)",
        },
        ".cm-searchMatch": {
          backgroundColor: "var(--warning-bg)",
          outline: "1px solid var(--warning-text)",
        },
        ".cm-searchMatch-selected": {
          backgroundColor: "var(--editor-bracket-bg)",
          outline: "1px solid var(--editor-bracket-border)",
        },
        ".cm-panels": {
          color: "var(--text)",
          backgroundColor: "var(--surface-raised)",
        },
        ".cm-tooltip": {
          color: "var(--text)",
          backgroundColor: "var(--surface-raised)",
          borderColor: "var(--border)",
        },
      },
      { dark },
    ),
    syntaxHighlighting(highlighting),
  ];
}
