import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon";
import { MoreMenu } from "../MoreMenu";
import { platformShortcut } from "../../utils/shortcuts";
import { editorPhrases } from "../../i18n/editor";
import { useEditorPreferences } from "../../stores/editorPreferences";
import {
  editingExtensions,
  languageExtensions,
  sharedExtensions,
  type EditorLanguage,
} from "./editorExtensions";
import { editorTheme } from "./editorTheme";
import { EditorSessions } from "./editorSessions";

type Props = {
  stateKey: string;
  sessions: EditorSessions;
  value: string;
  language?: EditorLanguage;
  theme: "light" | "dark";
  label: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
};

export function CodeEditor({
  stateKey,
  sessions,
  value,
  language = "text",
  theme,
  label,
  readOnly = false,
  onChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configurationRef = useRef<Compartment | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [wrap, setWrap] = useState(() => sessions.get(stateKey)?.wrap ?? false);
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [formatError, setFormatError] = useState("");
  const { fontSize } = useEditorPreferences();

  const formatJson = (view: EditorView) => {
    if (
      readOnly ||
      language !== "json" ||
      view.state.doc.length > 5 * 1024 * 1024 ||
      view.composing
    )
      return false;
    try {
      const formatted = JSON.stringify(
        JSON.parse(view.state.doc.toString()),
        null,
        2,
      );
      if (formatted !== view.state.doc.toString()) {
        const head = Math.min(view.state.selection.main.head, formatted.length);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
          selection: EditorSelection.cursor(head),
          annotations: Transaction.userEvent.of("input.format"),
        });
      }
      setFormatError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offset = /position (\d+)/.exec(message);
      const reportedLine = /line (\d+) column (\d+)/.exec(message);
      const line = offset
        ? view.state.doc.lineAt(
            Math.min(Number(offset[1]), view.state.doc.length),
          )
        : null;
      setFormatError(
        line
          ? t(
              "JSON format error at line %{line}, column %{column}: %{message}",
              {
                line: line.number,
                column: Number(offset![1]) - line.from + 1,
                message,
              },
            )
          : reportedLine
            ? t(
                "JSON format error at line %{line}, column %{column}: %{message}",
                { line: reportedLine[1], column: reportedLine[2], message },
              )
            : t("JSON format error: %{message}", { message }),
      );
    }
    return true;
  };

  // Reconfigure extensions in place: theme/language changes never replace the document or history.
  const configuration = () => [
    editorTheme(theme === "dark"),
    editingExtensions(readOnly),
    languageExtensions(language, readOnly),
    EditorState.phrases.of(editorPhrases()),
    EditorView.contentAttributes.of({
      "aria-label": label,
      "aria-readonly": String(readOnly),
      spellcheck: "false",
      role: "textbox",
      "aria-multiline": "true",
    }),
    ...(wrap ? [EditorView.lineWrapping] : []),
    keymap.of([{ key: "Mod-Shift-f", run: formatJson }]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setFormatError("");
        if (!readOnly) onChangeRef.current?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged || update.focusChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        setPosition({ line: line.number, column: head - line.from + 1 });
      }
    }),
  ];

  useLayoutEffect(() => {
    if (!host.current) return;
    const cached = sessions.get(stateKey);
    const restoring =
      cached?.state.doc.toString() === value ? cached : undefined;
    let scrollRestored = !restoring;
    const compartment = cached?.configuration ?? new Compartment();
    configurationRef.current = compartment;
    const extensions = configuration();
    const state =
      cached?.state.doc.toString() === value
        ? cached.state.update({ effects: compartment.reconfigure(extensions) })
            .state
        : EditorState.create({
            doc: value,
            extensions: [sharedExtensions, compartment.of(extensions)],
          });
    const view = new EditorView({
      state,
      parent: host.current,
      scrollTo:
        cached?.state.doc.toString() === value ? cached.scroll : undefined,
    });
    viewRef.current = view;
    const line = state.doc.lineAt(state.selection.main.head);
    setPosition({
      line: line.number,
      column: state.selection.main.head - line.from + 1,
    });
    if (restoring) {
      view.requestMeasure({
        read: () => null,
        write: () => {
          view.scrollDOM.scrollTop = restoring.scrollTop;
          view.scrollDOM.scrollLeft = restoring.scrollLeft;
          scrollRestored = true;
        },
      });
    }
    return () => {
      sessions.set(stateKey, {
        state: view.state,
        configuration: compartment,
        // StrictMode can clean up a restored view before its first layout measurement.
        scrollTop: scrollRestored
          ? view.scrollDOM.scrollTop
          : restoring!.scrollTop,
        scrollLeft: scrollRestored
          ? view.scrollDOM.scrollLeft
          : restoring!.scrollLeft,
        scroll: scrollRestored ? view.scrollSnapshot() : restoring!.scroll,
        wrap: wrapRef.current,
      });
      view.destroy();
      viewRef.current = null;
    };
    // stateKey owns the document; other configuration changes are handled below.
  }, [stateKey, sessions]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = configurationRef.current;
    if (view && compartment)
      view.dispatch({ effects: compartment.reconfigure(configuration()) });
  }, [theme, language, readOnly, wrap, label, i18n.resolvedLanguage]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: EditorSelection.cursor(
        Math.min(view.state.selection.main.head, value.length),
      ),
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  const run = (command: (view: EditorView) => unknown) => {
    const view = viewRef.current;
    if (view) {
      command(view);
      view.focus();
    }
  };

  return (
    <div
      className="code-editor cm-theme"
      data-editor-key={stateKey}
      style={{ "--editor-font-size": `${fontSize}px` } as CSSProperties}
    >
      <div className="code-editor-toolbar">
        {readOnly && (
          <span className="code-editor-readonly">{t("Read only")}</span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("Find")}
          title={`${t("Find")} (${platformShortcut("F")})`}
          onClick={() => run(openSearchPanel)}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Word wrap")}
          title={t("Word wrap")}
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          <Icon name="wrap" />
        </button>
        {!readOnly && language === "json" && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("Format JSON")}
            disabled={value.length > 5 * 1024 * 1024}
            title={`${t("Format JSON")} (${platformShortcut("Shift+F")})`}
            onClick={() => run(formatJson)}
          >
            <Icon name="format" />
          </button>
        )}
        {language !== "text" && (
          <MoreMenu label={t("Editor actions")}>
            <button type="button" onClick={() => run(foldAll)}>
              {t("Fold all")}
            </button>
            <button type="button" onClick={() => run(unfoldAll)}>
              {t("Unfold all")}
            </button>
          </MoreMenu>
        )}
        <span className="code-editor-position">
          {t("Line %{line}, column %{column}", position)}
        </span>
      </div>
      {formatError && (
        <div className="code-editor-error" role="alert">
          {formatError}
        </div>
      )}
      <div className="code-editor-host" ref={host} />
    </div>
  );
}
