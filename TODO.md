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

6) MathLive editor integration (read-only render)
- Outcome: Render `!equation` blocks from YAML into MathLive components in the webview.
- Interfaces: MathLive runtime in webview; data contract: `{ mathjson, latex?, desc? }`.

7) Vega-Embed chart render (read-only)
- Outcome: Render `!chart` nodes using vega-embed with basic mark/encoding/data.
- Interfaces: `vega`, `vega-lite`, `vega-embed`; data contract mirrors README schema.

8) JSON Schema registration for RichYAML
- Outcome: Ship and register schema; enable validation/completions for `!equation`/`!chart` structures.
- Interfaces: `yaml.schemas` setting injection; schema file in extension bundle.

9) Workspace file resolver for chart data
- Outcome: Resolve `data.file` CSV/JSON from workspace; parse and deliver to webview.
- Interfaces: `vscode.workspace.fs.readFile`, CSV/JSON parser; postMessage channel `data:resolved`.

10) Preview synchronization from text edits
- Outcome: On document change, update webview preview without losing scroll/selection.
- Interfaces: `onDidChangeTextDocument`, debounced `preview:update` message.

11) Security review and threat modeling (webview)
- Outcome: Checklist and fixes for URI handling, sanitization, and isolation.
- Interfaces: VS Code webview security guidance; CSP; URI allowlist.

## v0.2 Usability

12) Two-way editing: MathLive → YAML
- Outcome: Edits in MathLive update `mathjson` (and optionally `latex`) in the text buffer.
- Interfaces: `webview.postMessage` → host apply-edit; minimal conflict resolution policy.

13) Two-way editing: Chart controls → YAML
- Outcome: Basic chart panel (title/mark/encodings) updates YAML nodes.
- Interfaces: Same messaging/edit application as above; validation against schema prior to edit.

14) Schema validation surfacing in preview
- Outcome: Show friendly errors/warnings for invalid equation/chart nodes.
- Interfaces: VS Code diagnostics provider or inline preview banner fed by JSON Schema validation.

15) “Open in Vega Editor” affordance (optional)
- Outcome: Button opens current chart spec in Vega Editor in browser.
- Interfaces: Generate Vega-Lite spec; use vega-embed convenience link; handle data inlined/stripped.

16) Command palette entries and keybindings
- Outcome: Commands for “Insert Equation,” “Insert Chart,” “Refresh Preview,” etc.
- Interfaces: `contributes.commands`, `registerCommand`, `keybindings`.

17) Accessibility and keyboard navigation pass
- Outcome: Navigable webview UI, ARIA roles, focus management.
- Interfaces: Web standards; VS Code webview accessibility guidelines.

## v0.3 Export

18) Export: LaTeX document
- Outcome: Command to export: equations rendered via Compute Engine, charts to SVG, injected into template.
- Interfaces: Compute Engine API (MathJSON→LaTeX), `vega-embed` `toImageURL`, Node fs; template variables contract.

19) Export: HTML document
- Outcome: Command to export a standalone HTML with MathJax and Vega runtime.
- Interfaces: MathJax script, Vega runtime bundles, asset inlining strategy.

20) Export configuration surface
- Outcome: Per-target settings (`exports.latex`, `exports.html`) read from YAML; override via command options.
- Interfaces: Settings contract as in README; quick-pick for presets.

## v1.0 Polishing

21) Snippets and quick insertions
- Outcome: Snippets for `!equation` and `!chart`; command-driven inserts with minimal forms.
- Interfaces: `contributes.snippets`, quick input UI.

22) Hover previews in YAML editor
- Outcome: Hover over equation/chart nodes shows rendered preview.
- Interfaces: `languages.registerHoverProvider`, lightweight renderer shared with webview.

23) Validation and round-trip test suite
- Outcome: Automated tests for schema conformance and MathJSON⇄LaTeX stability at export-time.
- Interfaces: Test runner (e.g., Mocha); golden files; Compute Engine.

24) Evaluate panel (optional)
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