import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--editor-keyword)" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--editor-string)",
  },
  { tag: tags.number, color: "var(--editor-number)" },
  { tag: [tags.bool, tags.null], color: "var(--editor-literal)" },
  { tag: tags.propertyName, color: "var(--editor-property)" },
  { tag: [tags.punctuation, tags.bracket], color: "var(--editor-punctuation)" },
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
          fontFamily: "var(--font-code)",
          lineHeight: "var(--line-copy)",
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
          outline: "1px solid var(--editor-occurrence-border)",
          backgroundColor: "var(--editor-occurrence-bg)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "var(--editor-active-line)",
        },
        ".cm-gutters": {
          color: "var(--editor-line-number)",
          backgroundColor: "var(--editor-gutter)",
          borderRight: "1px solid transparent",
        },
        ".cm-activeLineGutter": {
          color: "var(--text)",
          fontWeight: "600",
        },
        "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
          backgroundColor: "var(--editor-match-bg)",
          outline: "none",
          borderRadius: "2px",
          color: "var(--editor-match-text)",
        },
        ".cm-nonmatchingBracket": {
          backgroundColor: "transparent",
          outline: "none",
          textDecoration: "underline wavy var(--error-text)",
          textUnderlineOffset: "2px",
        },
        ".cm-searchMatch": {
          backgroundColor: "var(--warning-bg)",
          outline: "1px solid var(--warning-text)",
        },
        ".cm-searchMatch-selected": {
          backgroundColor: "var(--editor-occurrence-bg)",
          outline: "1px solid var(--editor-occurrence-border)",
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
