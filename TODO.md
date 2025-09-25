# RichYAML Delivery Plan (work-sized tasks)

Scope: management-level tasks sized to ~0.5–2 days each. Developer subtasks implied by these items should be handled within the assignee’s implementation notes. Each item specifies key interfaces to VS Code and third-party libraries.

## MVP v0.1

1) Extension scaffolding and packaging [DONE]
- Outcome: VS Code extension skeleton with build/package scripts and CI smoke build.
- Interfaces: VS Code extension host API; `vsce` packaging.

2) File association and activation events [DONE]
- Outcome: Associate `*.r.yaml` and YAML files containing `!equation`/`!chart` tags; activate on open.
- Interfaces: `contributes.languages`, `contributes.customEditors`, activation events.

3) CustomTextEditor registration [DONE]
- Outcome: Register a custom text editor for `*.r.yaml` that opens a webview alongside text.
- Interfaces: `vscode.window.registerCustomEditorProvider`, `CustomTextEditorProvider`.

4) Webview bootstrapping and CSP [DONE]
- Outcome: Webview bundle loads with strict CSP and local asset resolution.
- Interfaces: `webview.asWebviewUri`, `Content-Security-Policy` meta, message passing contract.

5) YAML parse/serialize service [DONE]
- Outcome: In-host YAML loader/saver with lossless round-trip of comments and tags when possible.
- Interfaces: `yaml` library of choice; message channel: `host<->webview` events `document:update`, `preview:request`.

6) MathLive editor integration (read-only render) [DONE]
- Outcome: Render `!equation` blocks from YAML into MathLive components in the webview.
- Interfaces: MathLive runtime in webview; data contract: `{ mathjson, latex?, desc? }`.

7) Vega-Embed chart render (read-only) [DONE]
- Outcome: Render `!chart` nodes using vega-embed with basic mark/encoding/data.
- Interfaces: `vega`, `vega-lite`, `vega-embed`; data contract mirrors README schema.

8) JSON Schema registration for RichYAML [DONE]
- Outcome: Ship and register schema; enable validation/completions for `!equation`/`!chart` structures.
- Interfaces: `yaml.schemas` setting injection; schema file in extension bundle.

### Inline previews in the YAML editor 

These items ensure equations, charts, and future rich types render inline in the regular YAML text editor, not only in a side webview/custom editor. The custom editor remains optional for a larger preview but the default experience is the normal YAML editor with inline previews.

9) Default to inline-in-editor mode [DONE]
- Outcome: Keep the standard YAML editor and render rich blocks inline using editor insets; make the custom editor an optional command (not default). Provide a setting `richyaml.preview.mode` = `inline` | `custom` (default: `inline`).
- Interfaces: VS Code configuration (`contributes.configuration`), commands (`contributes.commands`), (proposed/stable) API for editor webview insets or a decoration-based fallback; `registerCustomTextEditorProvider` priority set to `option`.
	- Implemented: `richyaml.preview.mode` setting with default `inline`; commands `RichYAML: Toggle Inline Previews` and `RichYAML: Open Custom Preview`.
	- Inline previews: MVP placeholder using `createWebviewTextEditorInset` when available, with decoration fallback. Will be refined in Task 10 with precise YAML AST→range mapping.

10) YAML AST → text range mapping [DONE]
- Outcome: Reliable mapping from parsed YAML nodes (e.g., `!equation`, `!chart`) to exact document ranges/lines to anchor inline previews and apply edits precisely.
- Interfaces: `yaml` CST/AST with ranges; incremental reparsing on text edits; `TextDocument` positions; debounce strategy.
	- Implemented: `findRichNodes(text)` returns tag, path, and start/end offsets using CST when available; inline renderer uses `positionAt(start)` to place insets accurately. Debounced re-render on edits.

11) Inline renderer and lifecycle [DONE]
- Outcome: A shared renderer bundle that can run inside inline insets (webview) with strict CSP; deterministic creation/disposal on scroll and edits; no memory leaks.
- Interfaces: Webview insets (or lightweight decoration fallback rendering images/text), `postMessage` channel: `preview:update`, `data:request`, `schema:issues`; virtualization windowing for many nodes.
	- Implemented: `media/inline.js` for single-node rendering (equation/chart) loaded in insets; CSP-safe resources (MathLive CDN + local vega-shim). Insets are created per node using Task 10 ranges and disposed/recreated on changes; debounce added.

12) Two-way editing from inline equation [DONE]
- Outcome: Edits in MathLive inset update the underlying YAML (`latex`) with undo/redo via WorkspaceEdit; basic conflict handling (fallback insert when property missing).
- Interfaces: `webview→host` `edit:apply` with `path/key/value`; `WorkspaceEdit` replacing value range via CST; minimal fallback insert.

13) Minimal inline chart controls → YAML [DONE]
- Outcome: Basic controls in the chart inset (title/mark/encodings dropdowns) that write back to YAML; validate against schema before applying.
- Interfaces: Same messaging/edit pipeline; schema validation preflight; small UX with keyboard support.

14) Visibility toggles and performance guardrails [DONE]
- Outcome: Commands and per-editor toggle to show/hide inline previews; global setting limits (max insets, max dataset size); debounced updates; background disposal when offscreen.
- Interfaces: `contributes.commands`, context keys, settings; measurement of render cost; lazy data hydration.
	- Implemented: Settings `richyaml.preview.inline.maxInsets`, `richyaml.preview.inline.maxDataPoints`, `richyaml.preview.inline.debounceMs`, `richyaml.preview.inline.offscreenBufferLines`. Commands `Show Inline Previews` and `Hide Inline Previews` added. Status bar toggle reflects per-editor state. Virtualized rendering by visible range; chart data truncated to limit; debounced updates on edits/scroll.

15) Inline insets security and accessibility [DONE]
- Outcome: Reviewed and tightened CSP/URI allowlist for insets; added ARIA roles and focus traversal (Esc/Ctrl+Enter) between text and insets; documented known limitations (diff editor, folding, screen readers).
- Interfaces: Webview security guidance; keyboard/focus management; `asWebviewUri` allowlist.
	- Implemented: Inline inset HTML sets strict CSP with disabled connect/frame/object/media sources; root container is focusable with role=group; equation editor and chart controls labeled with ARIA. Escape/Ctrl+Enter posts focus:return to host which restores focus to the corresponding line in the editor. README updated.

16) Workspace file resolver for chart data [DONE]
- Outcome: Resolve `data.file` CSV/JSON/YAML from workspace; parse and deliver to webview/inline insets. Truncate by `maxDataPoints`.
- Interfaces: `vscode.workspace.fs.readFile`, CSV/JSON/YAML parser; postMessage channel `data:resolved`/`data:error`.

17) Preview synchronization from text edits [DONE]
- Outcome: On document change, update webview preview without losing scroll/selection.
- Interfaces: `onDidChangeTextDocument`, debounced `preview:update` message.

18) Security review and threat modeling (webview) [DONE]
- Outcome: Added security settings (`allowNetworkResources`, `allowDataOutsideWorkspace`), hardened CSPs to default block external resources, passed no-network flag to Vega shim, constrained `localResourceRoots`, and restricted `data.file` to workspace by default; blocked http(s) in data paths.
- Interfaces: VS Code webview security guidance; CSP; URI allowlist.

### Stable Editor UX (ships without inline insets)

S0) Rich hovers for equations/charts [DONE]
- Outcome: Hovering over a `!equation` or `!chart` node shows a rich preview (SVG/PNG) in a Markdown hover, including a short description/title when present. Fast, no webview required.
- Interfaces: `languages.registerHoverProvider` for YAML/richyaml; render via lightweight renderer that outputs data URIs (MathLive → SVG/PNG snapshot; Vega → toImageURL) or cached assets; theme-aware background; small size budget.

S1) Quick Fix / Code Action: “Edit equation/chart…” [DONE]
- Outcome: Code action opens a compact webview editor (MathLive for equations; minimal chart controls) and applies `WorkspaceEdit` back to YAML with undo/redo. Minor conflicts handled via insert fallback; errors surfaced inline.
- Interfaces: `languages.registerCodeActionsProvider` (QuickFix), `WebviewPanel` mini editor, `workspace.applyEdit`, CST range mapping from Task 10, basic schema validation preflight.

S2) CodeLens and gutter badges [DONE]
- Outcome: Above each rich node, show CodeLens links: “Preview • Edit”. Optional gutter badges indicate rich content. Clicking Preview focuses the node line and shows a hover preview; Edit opens the mini editor (S1).
- Interfaces: `languages.registerCodeLensProvider`, `createTextEditorDecorationType` for gutter icon, commands to open/refresh preview and edit.
	- Implemented: CodeLens provider with Preview/Edit over each `!equation`/`!chart`; gutter badges with small SVG icons; command `richyaml.previewNode` to reveal line and show hover.

S3) Side preview panel (auto-synced) [DONE]
- Outcome: A narrow side panel shows a live preview of the currently selected/nearest rich node while keeping the full YAML visible in the Text Editor. Updates on cursor move/selection and document changes; supports multiple nodes with simple navigation.
- Interfaces: `window.registerWebviewViewProvider` (contributes.views), message passing `preview:update`, YAML node resolution by cursor (Task 10), debounced updates, CSP-safe rendering using existing renderer.
	- Implemented: `richyaml.sidePreview` view in Explorer. Auto-syncs to selection and doc changes, uses existing `media/inline.js` renderer with strict CSP and local assets. Handles `data:request` and forwards edits via existing edit command.

S4) Refactor shared edit engine (inline & side) [DONE]
- Outcome: Extracted inline edit logic to `src/applyEdits.ts` (`applyRichNodeEdit`), removed duplicated method in `InlinePreviewController`, mini editor and side preview now call shared function directly.
- Interfaces: Shared `applyRichNodeEdit` used by inline insets, mini editor panel, side preview.

S5) Side panel direct two-way editing [DONE]
- Outcome: Side preview now sends `preview:init` for first/changed node and applies edits directly via shared edit engine (`applyRichNodeEdit`); no mini editor spawn required.
- Interfaces: `sidePreview.ts` uses `applyRichNodeEdit` and differentiates `preview:init` vs `preview:update`.

Context window enhancement (v0.1.26) [DONE]
- Outcome: Side preview can optionally show neighboring rich nodes (read-only) around the selected node when `richyaml.sidePreview.contextWindow` > 0, providing multi-node context. Current node remains editable; neighbors are summarized.
- Interfaces: `sidePreview.ts` now sends `preview:multi` with items array; new webview script `media/sideView.js` handles multi-node rendering.

S6) Conflict & path validation in side edits [DONE]
- Outcome: If node path is stale (document changed), re-parse and locate node by structural match (tag + nearest range); show a non-blocking warning banner if edit skipped. Unit tests for stale path and missing property insert cases.
- Interfaces: `findRichNodes`, parse service, lightweight matching heuristic.

S7) Setting & UX polish for side edit panel [DONE]
- Outcome: Add setting `richyaml.sidePanel.mode` = `preview` | `edit` (default: `edit` once stable). Header label reflects mode; command `RichYAML: Toggle Side Panel Mode`. README updated to advertise side editing.
- Interfaces: `contributes.configuration`, commands, view title actions, README.

## v0.2 Usability

19) Two-way editing: MathLive → YAML [DONE]
- Outcome: Editing LaTeX now updates `latex` and auto-regenerates a `mathjson` object (lightweight adapter) so MathJSON stays in sync for external tools. Debounce increased (300ms) to reduce churn; conflict handling leverages existing path validation.
- Interfaces: `edit:apply` message triggers host `applyRichNodeEdit` which now invokes `latexToMathJSON` and inserts/updates `mathjson` property.

19.B) On the MathLive documentation states that "The Compute Engine manipulates MathJSON expressions. It can also convert LaTeX strings to MathJSON expressions (parsing) and output MathJSON expressions as LaTeX string (serializing)"
-Outcome: Replace the "stubbed out" latexToMathJSON function with a call to to the mathlive library parser.

19.C) Support _absent_ `latex` field in the YAML.
- Outcome: If the `latex` feild is missing, then when the equation is rendered, use the MatLive serialization capability to create the LaTeX for the equation editor in memory.  Likewise, when the equation is modified in the editor, use the parsing capability to update the `mathjson` field without having a `latex` field present.

20) Two-way editing: Chart controls → YAML
- Outcome: Basic chart panel (title/mark/encodings) updates YAML nodes.
- Interfaces: Same messaging/edit application as above; validation against schema prior to edit.

21) Schema validation surfacing in preview [DONE]
- Outcome: Show friendly errors/warnings for invalid equation/chart nodes.
- Interfaces: Inline/side preview banners with validation issues (host-side lightweight validator for required fields; first issue shown with tooltip of all). Future: diagnostics provider.

22) “Open in Vega Editor” affordance (optional)
- Outcome: Button opens current chart spec in Vega Editor in browser.
- Interfaces: Generate Vega-Lite spec; use vega-embed convenience link; handle data inlined/stripped.

23) Command palette entries and keybindings
- Outcome: Commands for “Insert Equation,” “Insert Chart,” “Refresh Preview,” etc.
- Interfaces: `contributes.commands`, `registerCommand`, `keybindings`.

24) Accessibility and keyboard navigation pass
- Outcome: Navigable webview UI, ARIA roles, focus management.
- Interfaces: Web standards; VS Code webview accessibility guidelines.

## v0.3 Export

25) Export: LaTeX document
- Outcome: Command to export: equations rendered via Compute Engine, charts to SVG, injected into template.
- Interfaces: Compute Engine API (MathJSON→LaTeX), `vega-embed` `toImageURL`, Node fs; template variables contract.

26) Export: HTML document
- Outcome: Command to export a standalone HTML with MathJax and Vega runtime.
- Interfaces: MathJax script, Vega runtime bundles, asset inlining strategy.

27) Export configuration surface
- Outcome: Per-target settings (`exports.latex`, `exports.html`) read from YAML; override via command options.
- Interfaces: Settings contract as in README; quick-pick for presets.

## v1.0 Polishing

28) Snippets and quick insertions
- Outcome: Snippets for `!equation` and `!chart`; command-driven inserts with minimal forms.
- Interfaces: `contributes.snippets`, quick input UI.

29) Hover previews in YAML editor
- Outcome: Hover over equation/chart nodes shows rendered preview.
- Interfaces: `languages.registerHoverProvider`, lightweight renderer shared with webview.

30) Validation and round-trip test suite
- Outcome: Automated tests for schema conformance and MathJSON⇄LaTeX stability at export-time.
- Interfaces: Test runner (e.g., Mocha); golden files; Compute Engine.

31) Evaluate panel (optional)
- Outcome: Panel to numerically/symbolically evaluate selected equation(s).
- Interfaces: Compute Engine; message bus shared with editor.

## Cross-cutting technical direction

- Data model: YAML is the single source of truth. Equations stored as MathJSON; `latex` is optional convenience. Charts modeled after Vega-Lite; allow `vegaLite:` override blocks.
- Messaging contract: `host→webview`: `preview:update`, `data:resolved`, `schema:issues`. `webview→host`: `edit:apply`, `data:request`, `telemetry:event`.
- Security: All local file access mediated by extension host; no arbitrary `fetch` in webview. Use strict CSP and `asWebviewUri`.
- Performance: For `data.file`, stream/parse in host and batch-transfer to webview; debounce updates; virtualize large lists.
- Telemetry (optional): Minimal, opt-in only; event names and payload schema documented.

## Acceptance checkpoints per milestone

- MVP: Open `*.r.yaml`, preview renders equations/charts, data.file resolver works, schema assists in editor.
- v0.2: Edits in preview update YAML, validation surfaced, optional Vega Editor link.
- v0.3: LaTeX/HTML exports produce viewable artifacts with equations and charts.
- v1.0: Snippets, hovers, tests pass; performance and accessibility reviewed.

## Conversation Summary

- 2025-08-28: Completed MVP Task 1. Added TypeScript extension scaffold (`package.json`, `tsconfig.json`, `src/extension.ts`), build/watch scripts, CI workflow to build and package via `vsce`, VS Code tasks/launch, ignore files, and `CHANGELOG.md`. Build validated locally.
- 2025-08-28: Completed MVP Task 2. Contributed `richyaml` language with patterns `*.r.yaml`/`*.r.yml`; added activation on `richyaml` and `yaml` files and workspaceContains globs; implemented detection of `!equation`/`!chart` tags and context key `richyaml.isRichYAML` on open/change.
 - 2025-08-28: Completed MVP Task 3. Registered `richyaml.editor` CustomTextEditor with an MVP webview placeholder syncing document text; wired package.json `customEditors` and build validated.
 - 2025-08-28: Completed MVP Task 4. Added `media/` assets, served via `asWebviewUri`; enforced strict CSP (default-src 'none', nonce'd script, no inline styles) and constrained `localResourceRoots`. Webview loads JS/CSS bundle and message passing (`preview:update`/`preview:request`) verified.
 - 2025-08-28: Completed MVP Task 5. Implemented YAML parse/serialize service using `yaml`; host now posts `document:update` with parsed tree (tags preserved). Webview shows YAML text, parse errors, and a structured preview.
 - 2025-08-28: Completed MVP Task 6. Webview scans parsed tree for `!equation` nodes and renders them as read-only MathLive fields with description headers; added fallback pretty-print for MathJSON when LaTeX absent; updated CSP and styles; README bumped to v0.1.6.
 - 2025-08-29: Completed MVP Task 8. Added `schemas/richyaml.schema.json` (draft-07) and registered it via `contributes.yamlValidation` for `*.r.yaml`/`*.r.yml`. README bumped to v0.1.8 and version extracted into `src/version.ts` at build.
 - 2025-08-29: Completed MVP Task 9. Added inline preview mode default (`richyaml.preview.mode`), toggle/open commands, and an MVP inline inset/decoration renderer. README bumped to v0.1.9.
 - 2025-08-29: Completed MVP Task 10. Added AST→range mapping via `findRichNodes` using YAML CST; integrated into inline renderer for precise anchoring with debounce. README bumped to v0.1.10.
 - 2025-08-29: Completed MVP Task 11. Implemented inline renderer bundle and host wiring to feed actual node data to insets; strict CSP and lifecycle mgmt. Ready for two-way editing in Task 12.
 - 2025-08-29: Completed MVP Task 12. Enabled editable MathLive insets for equations and applied `latex` updates back to YAML via precise range replace or insert; README bumped to v0.1.12.
 - 2025-08-29: Completed MVP Task 13. Added minimal inline chart controls (title, mark, x/y field+type) that write back to YAML with basic validation; README bumped to v0.1.13.
 - 2025-08-29: Completed MVP Task 14. Visibility toggles (show/hide + status bar), performance guardrails (maxInsets, maxDataPoints, debounce, offscreen buffer), and virtualization of inline insets; README bumped to v0.1.14.
 - 2025-08-29: Completed MVP Task 15. Tightened inline inset CSP/allowlist; added ARIA roles and focus traversal; documented limitations. README bumped to v0.1.15.
 - 2025-08-29: Completed MVP Task 16. Implemented workspace `data.file` resolver (CSV/JSON/YAML) with size cap and messaging for both Custom Preview and inline insets. README bumped to v0.1.16.
- 2025-08-29: Completed MVP Task 17. Debounced custom preview updates and preserved webview scroll/focus across document changes; inline behavior unchanged. README bumped to v0.1.17.
 - 2025-08-29: Completed MVP Task 18. Hardened security: CSP respects network toggle; Vega shim honors no-network; `data.file` is workspace-bound by default; new security settings added. README bumped to v0.1.18.
 - 2025-09-10: Updated default preview mode to `custom` (inline off by default). README updated to reflect the new default and how to enable inline insets; hover provider added for `!equation` and `!chart` with improved targeting.
 - 2025-09-10: Completed Stable Editor UX Task S1. Added Quick Fix “Edit equation/chart…” and command `RichYAML: Edit Equation/Chart` that opens a compact mini editor using the inline renderer bundle; edits write back via precise ranges. README bumped to v0.1.19.
 - 2025-09-10: Stabilized rich hovers and chart pipeline. Equations render as MathJax SVG data URIs; charts render headlessly via Vega to SVG with a lite-like compiler, value coercion, and better scale defaults. Added an in-memory SVG cache keyed by doc+node+version with a background pre-renderer to warm the cache. Switched Vega loader to dynamic import to avoid ESM/require issues and surfaced precise hover error messages. Hardened shutdown by guarding timers and webview posts to avoid unhandled cancellations when the extension host terminates.
 - 2025-09-10: Completed Stable Editor UX Task S2. Added CodeLens (Preview • Edit) and gutter badges for rich nodes; new command `RichYAML: Preview Node`. README bumped to v0.1.20.
 - 2025-09-10: Completed Stable Editor UX Task S3. Added side preview Webview View (`richyaml.sidePreview`) that auto-syncs to the selected/nearest rich node and supports edits/data requests using the inline renderer. README bumped to v0.1.21.
 - 2025-09-15: Completed v0.2 Task 21. Added lightweight validation module surfacing errors/warnings (missing mathjson, chart title/encoding/data) in inline and side previews via issue banners. README bumped to v0.1.22.
- 2025-09-15: Completed Stable Editor UX Task S4. Refactored shared edit engine into `applyEdits.ts`; side preview now applies edits directly without command indirection; removed duplicate logic from inline controller. README bumped to v0.1.23.
- 2025-09-15: Completed Stable Editor UX Task S5. Side panel now directly edits YAML using shared engine with proper preview:init/update messages; removed dependency on mini editor for side edits. README bumped to v0.1.24.
 - 2025-09-15: Focus preservation fix: equation inline/side edits no longer steal focus back to YAML on each preview update by incremental updating math-field. README bumped to v0.1.25.
 - 2025-09-15: Added side preview multi-node context window and interactive chart controls with neighbor navigation & fold preservation. README bumped to v0.1.26.
 - 2025-09-15: Completed Stable Editor UX Task S6. Added path validation & stale edit skipping with warning banner (edit:skipped) plus heuristic fallback. README unchanged (feature internal) but version context advanced.
 - 2025-09-15: Completed Stable Editor UX Task S7. Added `richyaml.sidePanel.mode` setting (edit|preview) and toggle command. Side panel honors preview (read-only). README bumped to v0.1.27.
 - 2025-09-15: Completed v0.2 Task 19. Implemented LaTeX→MathJSON stub adapter, automatic `mathjson` regeneration on LaTeX edits, increased debounce to 300ms, docs updated. Version bumped to v0.2.19.