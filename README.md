# RichYAML v0.1.14
VSCode Extension to view/edit YAML with in place rendering of formulas and charts (and more)

YAML as a single, portable “source of truth” with equations stored as MathJSON and declarative charts.

## Inline previews in the regular YAML editor

RichYAML’s core requirement is that equations, charts, and other rich displays render inline alongside your YAML text. You keep using the normal YAML editor; RichYAML adds inline “insets” where `!equation` and `!chart` nodes appear. Edits you make in those insets write back to the YAML so the file remains the single source of truth.

- Design default: Inline. The custom editor with a big preview remains optional. While this capability is being rolled out, you can switch modes as needed.
- Two-way edits: Editing a mathfield updates `mathjson` (and optionally `latex`); basic chart controls update the `encoding`/`title`.
  - Implemented inline: equations (latex) and minimal chart controls (title, mark, x/y field+type) writing back to YAML with simple validation.
- Precise mapping: Insets are anchored to the exact node range in the file. If surrounding text changes while you’re editing, RichYAML retries or shows a small conflict banner.
- Toggle visibility: You can show/hide all inline previews per editor if you just want plain text temporarily.

Settings and commands (planned/rolling out):
- `richyaml.preview.mode`: `inline` (default) | `custom` — choose inline insets in the YAML editor, or open the Custom Editor as the default.
- `RichYAML: Toggle Inline Previews` — per-editor on/off.
- `RichYAML: Open Custom Preview` — open the side-by-side/custom view when you need a larger canvas.
 - `RichYAML: Show Inline Previews` / `RichYAML: Hide Inline Previews` — explicit controls for visibility.

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

Inline insets vs. stable VS Code:
- True inline webview insets require the proposed API (editorInsets). In stable VS Code builds, this API isn’t enabled, so RichYAML uses a decoration fallback (a compact after-text marker) instead of full inline renders.
- To try insets during development: run VS Code in Extension Development Host with proposed API enabled, e.g. launch args `--enable-proposed-api TBillTech.richyaml`. Otherwise, use the Custom Preview for rich rendering.

## Document format:

The principle difference between RichYAML and unrestricted YAML is that RichYAML has a set of special types which are rendered nicely in the VSCode extension:

The equation type is a MathJSON tree and optional latex to be rendered, with the following expected attributes: desc?, mathjson (the MathJSON tree), and optional latex (for round-tripping/authoring).

The chart type is a basic grouping of information needed for rendering a chart, with the following attributes: title, axes, legend, color, data (inline or file: refs), and an optional vegaLite block for advanced overrides.

The include type is a way to include data from other files without forcing data to be in line, and supports other displayed types, with the following attributes: uri (such as file::series.csv), x_column, y_column.  It uses the file extension which can be one of csv, json, or yaml in order to decode the columns and match the names given for supporting charts.

The include type can also be one of .png, .jpg.  A common format for meshes and animations is also planned.

The export type contains per-target settings (e.g., LaTeX template options).

## Editing/preview experience:

A Custom Editor with a Webview shows a two-pane UI: YAML source (Monaco or the built-in editor) + rich preview. Use message passing to sync changes. 

Equations: embed MathLive in the webview—author in a mathfield, store canonical MathJSON back into the YAML; use Compute Engine for validation/simplification and LaTeX round-trip. 

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

Packaging (optional):

```bash
npx vsce package --no-dependencies
```


