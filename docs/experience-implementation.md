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

Implemented incrementally:

- Resending retains the previous response, its metrics and original environment/time, with an explicit previous-response label until a new result arrives. Network failure and cancellation retain it too; cancellation has a neutral status in the response pane.
- Synchronous execution registration prevents duplicate sends from rapid shortcuts. Cancellation during workspace persistence stops the subsequent network send. Result/error/cleanup updates require a matching execution ID, so closing and reopening a request cannot receive an older execution's result or lose its new Cancel state.
- Browser regression coverage includes failure, cancellation/retry in both languages, cancellation before send, rapid shortcuts and closing/reopening while an older execution completes.
- Draft debounce and write ordering belong to each request. Inactive requests keep saving their drafts; reopening a closed collection request restores its retained edits. Explicit Save/deletion is queued after earlier draft writes, preventing stale drafts from returning. Slow close flushes newer input, preserves the user's newly selected tab and retains the editable tab on write failure.
- Delayed collection saves merge request edits into the latest workspace, so a newer environment selection or settings edit is not overwritten by the timer's older workspace snapshot.
- Manual sends take a cloned execution workspace containing the selected environment, globals and collection/folder inheritance chain before awaiting persistence. The native command consumes this snapshot, with a storage fallback for older callers. Subsequent UI changes do not change those scope values or the displayed execution environment. OS credential references remain references, resolved by the existing backend credential store.

Validation for this lifecycle audit: browser regressions reproduce tab-switch draft loss, reopening stale collection content, stale writes after Save, environment switching during a delayed send, environment rollback during delayed autosave, editing/switching during slow close and draft-write failure/retry. Unit checks cover independent debounce, ordered writes/deletion, retry and cloned execution scopes. The current execution host has no Rust toolchain; native compilation, the real Rust bridge and packaged Windows/macOS execution still require platform CI/acceptance.

Pending: explicit collection Save vs automatic draft saving; stable key-value row identity/paste; variable inspector; Console selection/maximization; shared viewer for MCP execution details. Existing collection autosave and save-before-send behavior remain in place.

## Phase C — scripts

Implemented the bounded synchronous script subset described in [scripts.md](scripts.md): request/collection/folder scripts, pre-request and post-response editors, snippets, scoped variables, response access, basic tests, console logs, and shared manual/MCP orchestration. Imported scripts remain disabled until the request opts in. Full Postman Sandbox compatibility and native Windows runtime verification remain outside this delivery.

## Phase D — compatibility and native acceptance

Pending: script round-trip tests, MCP execution parity, variable patch conflicts, large-response background formatting/preview improvements, native OS acceptance and full workflow checks. Further work follows the gates and acceptance scenarios in the design.

## 2026-10-18: reduce visual weight and speed up routine input

Synced clean `dev` to `ba3314d` before this work, preserving the draft ordering, send/environment snapshot and status-dot fixes. Application version remains 0.11.0.

- Editor tools: Find, Word wrap and applicable Format JSON remain directly available. Fold/unfold are in an editor-specific More menu. Font size is controlled once in Settings, persisted through the existing editor preference store and applied to both request/response editors. Editor sessions, folds, history and keyboard commands remain intact.
- Auxiliary buttons: resource controls, Save and editor/Console helpers use quiet surfaces; Send remains the primary action. Hover, keyboard focus, selected and disabled states remain distinguishable. Focused editors use one border without an additional inset shadow.
- Copy feedback: response, header, cURL, Console diagnostics and MCP connection copying use a shared 1.6-second, action-scoped acknowledgement. Repeated copies restart the timer; unmounts cancel it; clipboard failures never display success and receive a clipboard-specific error. Clipboard contents are not placed in feedback state or persisted. Import/recovery notices retain their existing behavior.
- Platform hints: Save/Search/Find/JSON-format hints use `Ctrl` on Windows/Linux and `⌘` on macOS. Console no longer displays a modifier symbol that did not describe an actual shortcut. Both language dictionaries remain aligned.
- Key/value input: an uncommitted trailing blank row allows direct continued input without clicking Add row. Placeholder rows do not trigger writes. Params accepts multi-line key=value, query strings and two/three-column spreadsheet rows; Headers accepts multi-line name:value and spreadsheet rows. The parser preserves duplicate keys, empty values, templates, colons/equals signs inside values, existing following rows and disabled flags. Partly unrecognized input falls back to ordinary paste instead of being partly imported. Bulk paste is enabled only in the request Params/Headers sections; secret variable editing retains its blur-to-commit behavior. Secret checkboxes now have row-specific accessible labels.

Validation: production TypeScript/Vite build, ESLint, 22 Vitest cases, 4 version-sync cases and 76 Playwright cases pass. Added coverage includes shared font persistence, compact menu access, both-theme focus/button styles, placeholder exclusion from saved data, lossless multi-line paste, repeated-copy timing/failure, and Windows-style hints in both languages. Reviewed `artifacts/experience-refinement-light.png` and `artifacts/experience-refinement-dark.png`. Vite still reports the existing >500kB chunk advisory.

No Rust/request-engine code, schemas, release workflows or product versions were changed. The available prebuilt Rust test adapters were exercised by the HTTP/SQLite and MCP browser workflows. Recompiling native Rust adapters was not possible because the temporary Cargo toolchain is absent; native macOS/Windows packaging and UI acceptance were not performed for this pass.

## 2026-10-18: synchronous request scripts and response chaining

- Added an isolated QuickJS runtime with bounded time, memory, stack, writes and output. Pre-request scripts run before template resolution; post-response scripts finish and commit their variable changes before execution completes.
- Added request/collection/folder editors, both script phases, opt-in for imported scripts, snippets, basic assertions and per-execution logs/results. Export writes edited request events back to the Postman item and removes internal enable flags.
- Variable writes merge into the latest workspace under the service write lock. Revision checks and client-side rebasing preserve new script tokens when unrelated UI saves or explicit local variable edits overlap. Frozen environment/collection IDs, phase rollback, staged Secret references and redaction remain in effect.
- Manual sends and MCP share the runtime. MCP previews have no persistent script effects and cache the prepared request; running uses that frozen request once. MCP script writes are restricted to the authorized collection/environment and cannot modify globals.
- Validation: frontend build and ESLint; 26 Vitest checks plus 4 version checks; Rust format and Clippy with warnings denied; 58 passing Rust tests (one interactive OS keychain test remains ignored); 78 passing browser regressions, including real Rust HTTP/SQLite chaining, restart, pre/post failure diagnostics and light/dark script editor visibility.
- The temporary macOS Rust toolchain was restored for this implementation and both test adapters were rebuilt. Windows/native WebView acceptance and new installer packaging were not performed. See [scripts.md](scripts.md) for the exact supported API subset and usage.
