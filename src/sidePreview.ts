import * as vscode from 'vscode';
import { parseWithTags, findRichNodes, RichNodeInfo, getTagLineForNode } from './yamlService';
import { applyRichNodeEdit } from './applyEdits';
import { validateEquation, validateChart } from './validation';
import { resolveDataFileRelative } from './dataResolver';

export class RichYAMLViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'richyaml.sidePreview';
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private lastDoc?: vscode.TextDocument;
  private lastNode?: RichNodeInfo;
  private debounce?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {
    console.log('[RichYAML] RichYAMLViewProvider constructor called.');
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    console.log('[RichYAML] resolveWebviewView called for side preview.');
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webview.html = this.getHtml(webview);

    const onMsg = webview.onDidReceiveMessage(async (m) => {
      if (!this.lastDoc) return;
      if (m?.type === 'edit:apply') {
        // Respect side panel mode: in preview mode, ignore edits
        const mode = vscode.workspace.getConfiguration('richyaml').get<string>('sidePanel.mode', 'edit');
        if (mode === 'preview') {
          try { webview.postMessage({ type: 'edit:skipped', reason: 'preview-mode', path: m?.path }); } catch {}
          return;
        }
        try {
          const ok = await applyRichNodeEdit(this.lastDoc, m);
          if (!ok) {
            try { webview.postMessage({ type: 'edit:skipped', reason: 'stale-path', path: m?.path }); } catch {}
            // Force a refresh to resync paths
            this.scheduleUpdate();
          }
        } catch {}
      } else if (m?.type === 'data:request') {
        try {
          const cfg = vscode.workspace.getConfiguration('richyaml');
          const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
          const values = await resolveDataFileRelative(this.lastDoc.uri, String(m.file || ''), maxPts);
          webview.postMessage({ type: 'data:resolved', path: m?.path, file: m?.file, values });
        } catch (e: any) {
          webview.postMessage({ type: 'data:error', path: m?.path, file: m?.file, error: e?.message || String(e) });
        }
      } else if (m?.type === 'navigate:to') {
        // Move cursor to the tag line (header) to avoid expanding folded region
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        if (doc.uri.toString() !== this.lastDoc.uri.toString()) return;
        const text = doc.getText();
        const nodes = findRichNodes(text);
        const target = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(m.path));
        if (!target) return;
        let offset = target.range.start;
        try {
          const tagInfo = getTagLineForNode(text, target);
          if (typeof tagInfo?.offset === 'number') offset = tagInfo.offset;
        } catch {}
        const pos = doc.positionAt(offset);
        editor.selections = [new vscode.Selection(pos, pos)];
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        this.scheduleUpdate();
      }
    });
    this.disposables.push(onMsg);

    // Listen to selection, active editor, and document changes
    this.disposables.push(vscode.window.onDidChangeTextEditorSelection(() => this.scheduleUpdate()));
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.scheduleUpdate()));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (this.lastDoc && e.document.uri.toString() === this.lastDoc.uri.toString()) this.scheduleUpdate();
    }));

    this.updateNow();
  }

  dispose() {
    for (const d of this.disposables.splice(0)) try { d.dispose(); } catch {}
  }

  private scheduleUpdate() {
    clearTimeout(this.debounce as any);
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const delay = Math.max(50, Number(cfg.get('preview.inline.debounceMs', 150)) || 150);
    this.debounce = setTimeout(() => this.updateNow(), delay);
  }

  private updateNow() {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return this.clear();
    const doc = editor.document;
    if (!this.isYamlLike(doc)) return this.clear();
    const text = doc.getText();
    const nodes = findRichNodes(text);
    if (!nodes.length) return this.clear();
    const node = this.pickNodeForSelection(doc, nodes, editor.selection.active);
    if (!node) return this.clear();
    const parsed = parseWithTags(text);
    if (!parsed.ok) {
      // Show an explicit invalid YAML banner instead of clearing silently
      try { this.view.webview.postMessage({ type: 'preview:error', error: 'Invalid YAML: ' + parsed.error }); } catch {}
      return;
    }
    const data = this.getNodePayloadFromTree(parsed.tree as any, node);
    if (!data) return this.clear();
    const previousPath = this.lastNode ? JSON.stringify(this.lastNode.path) : undefined;
    const nextPath = JSON.stringify(node.path);
    const first = !this.lastNode || previousPath !== nextPath || this.lastDoc?.uri.toString() !== doc.uri.toString();
    this.lastDoc = doc; this.lastNode = node;

    // Determine context window (neighbor count before/after)
    const cfg = vscode.workspace.getConfiguration('richyaml');
  const contextWindow = Math.max(0, Number(cfg.get('sidePreview.contextWindow') ?? cfg.get('richyaml.sidePreview.contextWindow') ?? cfg.get('richyaml.sidePreview.contextWindow', 0)) || 0);
  const mode = cfg.get<string>('sidePanel.mode', 'edit');

    if (contextWindow > 0) {
      // multi-node payload
      const centerIndex = nodes.indexOf(node);
      const items: any[] = [];
      const start = Math.max(0, centerIndex - contextWindow);
      const end = Math.min(nodes.length - 1, centerIndex + contextWindow);
      for (let i = start; i <= end; i++) {
        const n = nodes[i];
        const d = this.getNodePayloadFromTree(parsed.tree as any, n);
        if (!d) continue;
        const nt = n.tag === '!chart' ? 'chart' : 'equation';
        const iss = nt === 'equation' ? validateEquation(d) : nt === 'chart' ? validateChart(d) : [];
        items.push({ nodeType: nt, data: d, path: n.path, current: n === node, issues: iss });
      }
  try { this.view.webview.postMessage({ type: 'preview:multi', items, mode }); } catch {}
      return;
    }

    // single node path
    const nodeType = node.tag === '!chart' ? 'chart' : 'equation';
    const issues = nodeType === 'equation' ? validateEquation(data) : nodeType === 'chart' ? validateChart(data) : [];
  const payload = { type: first ? 'preview:init' : 'preview:update', nodeType, data, path: node.path, issues, mode };
    try { this.view.webview.postMessage(payload); } catch {}
  }

  private clear() {
    if (!this.view) return;
    try { this.view.webview.postMessage({ type: 'preview:update', nodeType: 'none', data: undefined, path: [] }); } catch {}
    this.lastDoc = undefined; this.lastNode = undefined;
  }

  private isYamlLike(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'yaml' || doc.languageId === 'richyaml';
  }

  private pickNodeForSelection(doc: vscode.TextDocument, nodes: RichNodeInfo[], pos: vscode.Position): RichNodeInfo | undefined {
    const off = doc.offsetAt(pos);
    let inside = nodes.find(n => off >= n.range.start && off <= n.range.end);
    if (inside) return inside;
    // pick nearest by start line distance
    const line = pos.line;
    let best: RichNodeInfo | undefined; let bestDist = Number.MAX_SAFE_INTEGER;
    for (const n of nodes) {
      const l = doc.positionAt(n.range.start).line;
      const d = Math.abs(l - line);
      if (d < bestDist) { best = n; bestDist = d; }
    }
    return best;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const allowNet = !!cfg.get('security.allowNetworkResources', false);
  const contextWindow = Math.max(0, Number(cfg.get('sidePreview.contextWindow') ?? cfg.get('richyaml.sidePreview.contextWindow') ?? cfg.get('richyaml.sidePreview.contextWindow', 0)) || 0);
  const mode = cfg.get<string>('sidePanel.mode', 'edit');
    const style = [
      `:root{color-scheme:var(--vscode-colorScheme, light dark)}`,
      `body{margin:0;font:12px/1.35 var(--vscode-editor-font-family);color:var(--vscode-foreground);}`,
      `.header{padding:6px 8px;font-weight:600;border-bottom:1px solid var(--vscode-panelSectionHeader-border);}`,
      `#root{padding:6px 4px;overflow:auto;max-height:100vh;}`,
      `.ry-node{border-bottom:1px solid var(--vscode-panel-border,#4443);padding:4px 2px;}`,
      `.ry-node:last-child{border-bottom:none;}`,
      `.ry-head{font-weight:600;margin-bottom:2px;font-size:11px;opacity:.85;}`,
      `.ry-body{margin:2px 0 4px;}`,
      `.ry-chart-summary{font-size:11px;opacity:.75;}`,
  `.ry-chart-current{font-size:11px;opacity:.6;}`,
  `.ry-clickable{cursor:pointer;}`,
  `.ry-clickable:hover{background:var(--vscode-list-hoverBackground,#0001);}`,
  `.ry-current{background:var(--vscode-list-activeSelectionBackground,#0a639933);}`
    ].join('\n');
    const mathliveCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-static.css')).toString();
    const mathliveFontsCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-fonts.css')).toString();
    const mathliveJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive.min.js')).toString();
  const computeEngineJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'compute-engine.min.js')).toString();
    const vegaShimUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vega-shim.js'));
    const vegaLocalFs = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'vega.min.js');
    const interpLocalFs = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'vega-interpreter.min.js');
    const vegaLocalUri = webview.asWebviewUri(vegaLocalFs);
    const interpLocalUri = webview.asWebviewUri(interpLocalFs);
  const inlineJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline.js'));
  const sideViewJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sideView.js'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} ${allowNet ? 'https:' : ''} data:`,
      `style-src ${webview.cspSource} ${allowNet ? 'https:' : ''} 'unsafe-inline'`,
      `font-src ${webview.cspSource} ${allowNet ? 'https:' : ''}`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' ${allowNet ? 'https:' : ''}`,
      `connect-src 'none'`,
      `frame-src 'none'`,
      `child-src 'none'`,
      `media-src 'none'`,
      `object-src 'none'`,
      `base-uri 'none'`,
      `form-action 'none'`
    ].join('; ');
    return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${mathliveFontsCss}">
<link rel="stylesheet" href="${mathliveCss}">
<style>${style}</style>
</head><body>
<div class="header">RichYAML Preview</div>
<div id="root" role="group" aria-label="RichYAML side preview" tabindex="0"></div>
<script nonce="${nonce}" src="${computeEngineJs}"></script>
<script nonce="${nonce}" src="${mathliveJs}"></script>
<script nonce="${nonce}" src="${vegaShimUri}" data-vega="${vegaLocalUri}" data-interpreter="${interpLocalUri}"${!allowNet ? ' data-no-network="true"' : ''}></script>
${contextWindow > 0 ? `<script nonce="${nonce}" src="${sideViewJsUri}"></script>` : `<script nonce="${nonce}" src="${inlineJsUri}" data-mode="${mode}"></script>`}
</body></html>`;
  }

  private getNodePayloadFromTree(tree: any, node: RichNodeInfo): any | undefined {
    let cur: any = tree;
    for (const seg of node.path) {
      if (cur == null) return undefined;
      if (typeof seg === 'number') {
        const arr = Array.isArray(cur) ? cur : Array.isArray(cur?.$items) ? cur.$items : undefined;
        if (!arr || seg < 0 || seg >= arr.length) return undefined;
        cur = arr[seg];
      } else {
        cur = cur?.[seg];
      }
    }
    if (!cur || typeof cur !== 'object') return undefined;
    const tag = String((cur as any).$tag || '');
    if (tag !== node.tag) return undefined;
    if (tag === '!equation') {
      const { latex, mathjson, desc } = cur as any;
      return { latex, mathjson, desc };
    }
    if (tag === '!chart') {
      const { title, mark, data, encoding, legend, colors, vegaLite, width, height } = cur as any;
      return { title, mark, data, encoding, legend, colors, vegaLite, width, height };
    }
    return undefined;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
