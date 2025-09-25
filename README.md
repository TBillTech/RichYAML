# RichYAML v0.2.22
VSCode Extension to view/edit YAML with in place rendering of formulas and charts (and more)

YAML as a single, portable “source of truth” with equations stored as MathJSON and declarative charts.

## Roadmap (Focused on Computer‑Aided Algebra & Validation)

RichYAML’s longer-term direction is to support reproducible mathematical derivations inside YAML, bridging symbolic and numeric workflows. Key planned pillars:

### 1. Equation Labeling & Provenance
- Inline label support: `label: eq.energy` inside `!equation` nodes.
- Automatic back‑references: when an equation cites `eq.energy`, the preview shows a hover with the referenced MathJSON + rendered form.
- Provenance chain: each derived equation stores `from: [eq.energy, eq.gammaDef]` and an optional `operation: substitute` metadata entry.

### 2. Assisted Algebraic Steps (Substitution / Simplification)
- Command palette action: “RichYAML: Derive From Equation…” prompts for:
  - Source equation label(s)
  - Transformation type (substitute, expand, factor, differentiate, integrate, solve for …)
  - Inputs (e.g. `a = r * \omega` or variable to solve for)
- Generates a new `!equation` node with:
  - `mathjson`: canonical transformed tree (using a future full parser / Compute Engine)
  - `latex`: regenerated from MathJSON to avoid drift
  - `from` / `operation` / `notes` metadata
- Insert position policy: directly after last contributing equation or into a dedicated `derivations:` section.

### 3. External CAS Integration
- Adapter layer for pluggable engines: Maxima, SymPy (Python), Compute Engine (MathLive), possibly Giac / Sage.
- Configuration in YAML or settings: preferred engine list + fallback.
- Serialization contract: send MathJSON + task descriptor `{ op: "substitute", binds: {...} }` and receive canonical MathJSON + diagnostics.
- Graceful degradation: if engine unavailable, fall back to stub (current Task 19 adapter) and mark equation with a warning (`engine: stub`).

### 4. Numerical Sanity & Regression Checks
- Optional `check:` block on equation nodes:
  ```yaml
  check:
    sample: 5            # number of random or strategic points
    domain:
      r: {min: 0, max: 10}
      omega: {min: 0.1, max: 2.0}
    tolerance: 1e-8
  ```
- Command “RichYAML: Run Equation Checks” executes numeric evaluations (substituting randomized values consistent with domain) and reports pass/fail summary inline (status bar + issue banners).
- Strategy library: deterministic corner cases + pseudo‑random to catch subtle domain errors.

### 5. Structured Derivation Blocks
- Higher‑level `!derivation` tag grouping ordered steps:
  ```yaml
  momentum_proof: !derivation
    title: Relativistic momentum steps
    steps:
      - ref: eq.energy
      - op: substitute
        using: eq.gammaDef
      - op: simplify
      - op: differentiate
        withRespectTo: v
  ```
- UI renders steps as a numbered ladder with collapsible intermediate forms; failed validation highlights the earliest broken step.

### 6. Interactive Step Verification
- Hover / command “Verify Step” recalculates only that step with the selected engine and diff‑highlights MathJSON trees (tree edit distance → minimal changes with color cues).
- If mismatch: option to accept engine’s canonicalized form (auto‑updates equation) or keep user’s version with a `verified: false` flag.

### 7. Export & Reproducibility
- Export derivations to LaTeX / HTML with step numbering, provenance footnotes, and optional collapsible sections.
- Deterministic hash of each equation’s MathJSON stored (`hash:`) enabling CI to detect accidental drift.

### 8. Plugin / API Surface
- Internal API: `richyaml.engine.apply(op, mathjson, options)` returning `{ mathjson, diagnostics }`.
- Extension points: other extensions can register additional operations (e.g., tensor simplification). Future: language server for deeper static analysis.

### 9. Inspiration & Related Tools Considered
- Jupyter / SymPy notebooks: great for exploratory math but weaker at immutable provenance + inline doc integration in a single text artifact.
- Lean / Coq proof assistants: rigorous but high overhead; RichYAML aims at “engineering‑grade” validation (catch algebra slips) without requiring full formal proof.
- Typst / LaTeX pipelines: produce final formatted docs; RichYAML focuses earlier in the lifecycle (authoring + validation) and can feed those exporters.
- CAS scripts (Maxima, Mathematica): powerful but often siloed away from the narrative data structure; RichYAML keeps everything co‑located.

### 10. Implementation Phasing (High Level)
| Phase | Milestone | Focus |
|-------|-----------|-------|
| P1 | v0.3 | Full MathJSON parser + reliable LaTeX round‑trip; substitution & simplify ops (core set). |
| P2 | v0.4 | Derivation blocks, equation labeling, provenance metadata, numeric check harness. |
| P3 | v0.5 | External CAS adapters (SymPy/Maxima), step verification diffs. |
| P4 | v0.6 | Advanced ops (solve/integrate/differentiate), plugin API draft. |
| P5 | v0.7 | Derivation export (LaTeX/HTML) with hashed integrity + CI helper. |
| P6 | v1.0 | Performance & accessibility polish, full test suite for algebra ops. |

### 11. Guiding Principles
- MathJSON remains canonical; LaTeX is a convenience view.
- All transformations are explicit & reversible (store source metadata).
- Fail soft: never lose user content; annotate uncertainty instead of blocking.
- Deterministic hashing enables trust + audit.

If you have feedback or want to prioritize a CAS engine, open an issue with your target operations and engine preference.


## Inline previews in the regular YAML editor

RichYAML’s core requirement is that equations, charts, and other rich displays render inline alongside your YAML text. You keep using the normal YAML editor; RichYAML can add inline “insets” where `!equation` and `!chart` nodes appear. Edits you make in those insets write back to the YAML so the file remains the single source of truth.

- Design default: Custom Preview. Inline insets are optional and can be enabled per editor or via a setting. This keeps the default experience stable while inline matures.
- Two-way edits: Editing a mathfield now updates `latex` and regenerates a stub `mathjson` structure automatically (Task 19). This keeps MathJSON as the canonical form for external CAS tools while allowing LaTeX authoring. Basic chart controls update `title`, `mark`, and `encoding` fields.
  - Implemented inline: equations (latex→mathjson stub adapter) and minimal chart controls (title, mark, x/y field+type) writing back to YAML with simple validation.
- Precise mapping: Insets are anchored to the exact node range in the file. If surrounding text changes while you’re editing, RichYAML retries or shows a small conflict banner.
- Toggle visibility: You can show/hide all inline previews per editor if you just want plain text temporarily.

Settings and commands (planned/rolling out):
- `richyaml.preview.mode`: `custom` (default) | `inline` — choose the default behavior: open the Custom Preview or render inline insets in the YAML editor.
- `RichYAML: Toggle Inline Previews` — per-editor on/off.
- `RichYAML: Open Custom Preview` — open the side-by-side/custom view when you need a larger canvas.
 - `RichYAML: Show Inline Previews` / `RichYAML: Hide Inline Previews` — explicit controls for visibility.
 - `richyaml.preview.inline.experimentalInsets` (default: false) — use the proposed editorInsets API for true inline webviews. Requires launching the Extension Development Host with proposed APIs enabled for this extension. When off (default on stable VS Code), a lightweight decoration fallback shows a marker instead.
 - `richyaml.sidePreview.contextWindow` (default: 0) — show neighboring rich nodes (read-only) around the selected one in the side preview, for quick comparison and multi-node context.
 - `richyaml.sidePanel.mode` (default: edit) — side panel behavior: `edit` enables in-panel editing of the current node; `preview` makes the side panel read-only (use inline previews or the Edit command to modify).

Schema validation surfacing (v0.1.22): Inline and side previews now display friendly banners for missing required fields (e.g., chart title, encoding fields, equation mathjson) and warnings for non-fatal issues (unknown mark/type, extraneous data shape). The first issue is shown inline with a tooltip listing all issues.

Performance guardrails (configurable):
- `richyaml.preview.inline.maxInsets` (default 12) — cap how many insets render at once.
- `richyaml.preview.inline.offscreenBufferLines` (default 20) — render only near the viewport.
- `richyaml.preview.inline.maxDataPoints` (default 1000) — truncate inline chart datasets.
- `richyaml.preview.inline.debounceMs` (default 150ms) — delay updates while typing/scrolling.

Limitations and caveats:
- Diff editors and read-only editors may not display interactive insets; RichYAML falls back to static thumbnails or a note.
- Very large files or many rich nodes: previews may be virtualized (only render what’s on screen) to keep the editor responsive.
- External data (`data.file`): loaded by the extension host and streamed to the inset; large CSV/JSON may be truncated based on settings.
- Accessibility: Insets are focusable and labeled, but screen reader behavior varies by platform. You can turn previews off per editor if needed.
 - Data resolver: For charts with `data.file`, RichYAML resolves CSV/JSON/YAML from your workspace (paths are relative to the YAML file). CSV must have a header row; JSON/YAML can be an array of objects or `{ values: [...] }`. The number of points sent to inline previews is capped by `richyaml.preview.inline.maxDataPoints`.

Inline insets vs. stable VS Code:
- True inline webview insets require the proposed API (editorInsets). In stable VS Code builds, this API isn’t enabled, so RichYAML uses a decoration fallback (a compact after-text marker) instead of full inline renders.
- To try insets during development: run VS Code in Extension Development Host with proposed API enabled, e.g. launch args `--enable-proposed-api TBillTech.richyaml`. The Custom Preview remains the default.
 - Checklist to enable inline insets in dev: (1) set `richyaml.preview.mode` to `inline` (or use the toggle command in an editor), and optionally enable `richyaml.preview.inline.experimentalInsets`; (2) launch the Extension Development Host with proposed APIs enabled for `TBillTech.richyaml`. If proposed API is off, the decoration fallback is used.

## Security and accessibility (inline insets)

- CSP is strict: default-src 'none'; scripts must be from the extension with a nonce. External CDNs are blocked by default; enable with `richyaml.security.allowNetworkResources` if needed.
- Resource allowlist: images/fonts/scripts/styles are constrained to the extension folder via `asWebviewUri` and https for MathLive. `connect-src`, `frame-src`, `object-src`, and `media-src` are disabled.
- Keyboard: Math editor and chart controls support Escape or Ctrl+Enter to return focus to the YAML editor. Controls are labeled, with ARIA roles for groups, headings, status, and alerts.
- Known limitations: Diff editors and some screen readers may not announce insets reliably. Use the “Hide Inline Previews” command or switch to the Custom Preview if needed.
 - Data access: By default, chart `data.file` must be inside your current workspace. You can allow external paths with `richyaml.security.allowDataOutsideWorkspace`.

## Document format:

The principle difference between RichYAML and unrestricted YAML is that RichYAML has a set of special types which are rendered nicely in the VSCode extension:

The equation type is a MathJSON tree and optional latex to be rendered, with the following expected attributes: desc?, mathjson (the MathJSON tree), and optional latex (for round-tripping/authoring).

The chart type is a basic grouping of information needed for rendering a chart, with the following attributes: title, axes, legend, color, data (inline or file: refs), and an optional vegaLite block for advanced overrides.

The include type is a way to include data from other files without forcing data to be in line, and supports other displayed types, with the following attributes: uri (such as file::series.csv), x_column, y_column.  It uses the file extension which can be one of csv, json, or yaml in order to decode the columns and match the names given for supporting charts.

The include type can also be one of .png, .jpg.  A common format for meshes and animations is also planned.

The export type contains per-target settings (e.g., LaTeX template options).

## Editing/preview experience:

A Custom Editor with a Webview shows a two-pane UI: YAML source (Monaco or the built-in editor) + rich preview. Use message passing to sync changes. 

Equations: embed MathLive in the webview—author in a mathfield, store canonical MathJSON back into the YAML; use Compute Engine for validation/simplification and LaTeX round-trip. Optional `override` (string or string array) forces listed symbols to be treated as plain variables instead of known constants during LaTeX→MathJSON parsing.

Charts: render from YAML → Vega-Lite spec → vega-embed. Support inline arrays or file: URI for CSV/JSON; add a resolver to load local workspace files into the webview. 

## Language features in the text editor:

Shipped JSON Schema registered via yaml.schemas so users get completions/validation/hover help in plain YAML mode too. 

## Export pipeline:

LaTeX export: use Compute Engine to turn MathJSON → LaTeX; render charts to SVG/PNG via vega-embed and write \includegraphics{...}. (Optional: map axes/legends to PGFPlots/TikZ later.) Use provided LaTeX journal or conference templates as input to properly format the full LaTeX document.

Other exports: defined according to the schema, emitting Typst/HTML/Markdown (MathLive/Compute Engine can also produce Typst/MathML if desirable). 

## Examples:

In RichYAML, the `!equation` and `!chart` types can be used as the value of any property or map entry, at any depth in the YAML tree. For example, a property can be defined as:

```yaml
pdf: !equation
  mathjson:
    fn: ["Equal", "E", ["Multiply", "m", ["Power", "c", 2], "γ"]]
  latex: E = \gamma m c^2
  desc: Relativistic energy
```

Or a chart can be embedded anywhere:

```yaml
chart: !chart
  title: "Speed over time"
  mark: line
  data:
    file: data/speed.csv
  encoding:
    x: {field: t, type: quantitative, title: "Time (s)"}
    y: {field: v, type: quantitative, title: "Speed (m/s)"}
```


Here is another example with both used:

```yaml
experiment:
  name: "Relativity Test"
  description: "A test of relativistic energy and velocity."
  parameters:
    mass: 1.0
    velocity: 0.8
    energy: !equation
      desc: Relativistic energy
      latex: E = \gamma m c^2
      mathjson:
        fn: ["Equal", "E", ["Multiply", "m", ["Power", "c", 2], "γ"]]
  results:
    - time: 0
      speed: 0
    - time: 1
      speed: 3.2
  analysis:
    speed_chart: !chart
      title: "Speed over time"
      mark: line
      data:
        values:
          - {t: 0, v: 0}
          - {t: 1, v: 3.2}
      encoding:
        x: {field: t, type: quantitative, title: "Time (s)"}
        y: {field: v, type: quantitative, title: "Speed (m/s)"}
      legend:
        orient: top
      colors: ["#1f77b4"]
  notes:
    - "The energy equation is attached to the 'energy' parameter."
    - "The speed chart is embedded under 'analysis'."
```


## JSON schema:

```json
{
  "$id": "https://example.com/richyaml.schema.json",
  "type": ["object", "array", "string", "number", "boolean", "null"],
  "properties": {},
  "additionalProperties": {
    "anyOf": [
      {"$ref": "#/definitions/equation"},
      {"$ref": "#/definitions/chart"},
      {"type": ["object", "array", "string", "number", "boolean", "null"]}
    ]
  },
  "definitions": {
    "equation": {
      "type": "object",
      "properties": {
        "mathjson": {"type": "object"},
        "latex": {"type": "string"},
        "desc": {"type": "string"}
      },
      "required": ["mathjson"]
    },
    "chart": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "mark": {"type": "string"},
        "data": {
          "oneOf": [
            {"type": "object", "properties": {"values": {"type": "array"}}},
            {"type": "object", "properties": {"file": {"type": "string"}}}
          ]
        },
        "encoding": {"type": "object"},
        "legend": {"type": "object"},
        "colors": {"type": "array", "items": {"type": "string"}},
        "vegaLite": {"type": "object"}
      },
      "required": ["title", "mark", "data", "encoding"]
    }
  }
}
```


## High-level architecture

### MVP:

- Scaffolding (yo code) + a CustomTextEditor for `*.r.yaml`.
- Bundle a webview that:
  - Renders MathLive editor and echoes MathJSON back into the YAML object.
  - Renders charts via vega-embed from the YAML.
- Webview security and assets: the preview uses a strict CSP (default-src 'none'; nonce'd scripts only) and loads local JS/CSS from the extension `media/` folder via `asWebviewUri`, with `localResourceRoots` restricted to the extension folder.
- Register your JSON Schema and connect it to files via `yaml.schemas`.
- Implement file resolver to load `data.file` CSV/JSON from workspace into the webview (using `vscode.workspace.fs` + `postMessage`).

### Key technical notes & gotchas

- **Webview security:** use `webview.asWebviewUri()` and a strict CSP. Resolve local data via the extension host (don’t let the webview fetch arbitrary paths).
- **Round-tripping equations:** store MathJSON as the canonical source of truth; keep `latex:` only as a convenience for authors. Use Compute Engine to regenerate LaTeX at export-time to avoid drift.
- **Chart spec scope:** model your YAML `encoding` after Vega-Lite so advanced users can drop in a full `vegaLite:` block when needed.
- **Performance:** for large datasets referenced by `file:`, stream/parse in the extension host, then send to the webview as JSON chunks.


## Develop locally

- Prereqs: Node 20+, VS Code.
- Install deps and build:

  ```bash
  npm ci
  npm run build
  ```

- Press F5 in VS Code to launch the Extension Development Host.
  - Optional: To test true inline insets, enable the `richyaml.preview.inline.experimentalInsets` setting, and use a launch that passes the proposed API flag for this extension. Without that, inline previews use the decoration fallback; the Custom Preview remains fully functional.

Packaging (optional):

```bash
npx vsce package --no-dependencies
```



