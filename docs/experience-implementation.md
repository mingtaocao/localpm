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

Collection requests now require explicit Save. Editing retains a separate local draft; Send flushes that draft and existing scope/settings writes, then executes the click-time snapshot without updating the saved request or clearing dirty state. The former two-second collection autosave is removed. Closing/reopening and restarting restore retained drafts; explicit Save updates the collection and removes the corresponding draft.

Validation covers idle edits, Send without workspace writes, snapshot isolation, cancellation during draft persistence, draft recovery after reload and explicit Save. Pending: stable key-value row identity/paste; variable inspector; Console selection/maximization; shared viewer for MCP execution details.

## Phase C — scripts

Implemented the core two-request workflow: editable pre-request/post-response scripts, bounded native QuickJS VM, core variable/response/request APIs, synchronous tests and logs, per-key conflict-checked variable persistence, frontend variable updates before the next send, and edited Postman event export. Imported scripts require explicit opt-in. Manual sends and MCP use the same runtime; MCP preview is read-only and global writes are denied. See [scripts.md](scripts.md) for the exact API subset and lifecycle.

Validation includes real HTTP/SQLite extraction and reuse, restart, scope switching, stale full saves, write conflicts, exceptions, timeout, import/export and MCP preview/run. Browser tests cover English/light and Chinese/dark with real Rust execution.

Pending: packaged Windows/macOS runtime and cancellation acceptance, expanded snippets/assertions, per-script source navigation, and the remaining full Phase C design. No full Postman Sandbox or Runner compatibility claim.

## Phase D — compatibility and native acceptance

Pending: script round-trip tests, MCP execution parity, variable patch conflicts, large-response background formatting/preview improvements, native OS acceptance and full workflow checks. Further work follows the gates and acceptance scenarios in the design.
