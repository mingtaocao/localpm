# Experience implementation status

Reference: [experience-design.md](experience-design.md). Base: main 0.7.0.

## Phase A — shared editors and independent request views

Implemented:

- A shared CodeMirror 6 editor for request raw bodies and manual response bodies.
- Read-only response state with a focusable reading cursor; typing, deletion and paste commands cannot edit the document.
- Explicit caret, selection, active line and bracket styles in both themes; JSON, JavaScript, HTML and XML language support.
- Find, wrap, fold/unfold, JSON formatting with undo/error feedback and a persisted editor font setting.
- In-memory editor sessions preserving selection, folds, history and scroll; cleanup when request tabs are removed.
- Request-specific configuration, response format and header-search state.
- Memoized response presentation; plain text is no longer unconditionally given a JSON parser.
- Minimum raw-body workspace height so toolbar additions do not hide the document at 900×640.

Validation:

- Build, ESLint and existing Vitest checks.
- Playwright editor tests for both themes, read-only input, brackets, format/undo, selection/copy, Chinese document content, folding, theme change, request-view isolation, scrolling and minimum-window controls.
- Existing mocked workspace and UI boundary regression tests.
- Platform CI runs the existing Rust and browser tests on Windows/macOS. These browser tests do not establish native WebView2/WKWebView input-method behavior.

Still requires native acceptance: real Chinese IME composition, OS 125%/150% scaling, caret/selection on WebView2 and WKWebView. This PR does not claim full Postman compatibility.

## Phase B — request workbench

Pending: explicit collection Save vs automatic draft saving; frozen execution environment/request context; preservation of previous responses; stable key-value row identity/paste; variable inspector; Console selection/maximization; shared viewer for MCP execution details. Existing autosave and execution behavior remain in place in Phase A.

## Phase C — scripts

Pending: cross-platform isolated runtime verification, script model/import migration, execution orchestration, supported pm API list, snippet editor, test results and script logs. Current imported scripts remain preserved and unexecuted.

## Phase D — compatibility and native acceptance

Pending: script round-trip tests, MCP execution parity, variable patch conflicts, large-response background formatting/preview improvements, native OS acceptance and full workflow checks. Further work follows the gates and acceptance scenarios in the design.
