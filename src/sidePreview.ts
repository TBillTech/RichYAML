import * as vscode from 'vscode';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';
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
        // Reuse inline edit pathway via command to avoid code duplication.
        try { await vscode.commands.executeCommand('richyaml.editNodeAtCursor', this.lastDoc.uri, m.path, m?.nodeType === 'chart' ? '!chart' : '!equation'); } catch {}
      } else if (m?.type === 'data:request') {
        try {
          const cfg = vscode.workspace.getConfiguration('richyaml');
          const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
          const values = await resolveDataFileRelative(this.lastDoc.uri, String(m.file || ''), maxPts);
          webview.postMessage({ type: 'data:resolved', path: m?.path, file: m?.file, values });
        } catch (e: any) {
          webview.postMessage({ type: 'data:error', path: m?.path, file: m?.file, error: e?.message || String(e) });
        }
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
    if (!parsed.ok) return this.clear();
    const data = this.getNodePayloadFromTree(parsed.tree as any, node);
    if (!data) return this.clear();
    this.lastDoc = doc; this.lastNode = node;
    const nodeType = node.tag === '!chart' ? 'chart' : 'equation';
  const issues = nodeType === 'equation' ? validateEquation(data) : nodeType === 'chart' ? validateChart(data) : [];
  const payload = { type: 'preview:update', nodeType, data, path: node.path, issues };
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
    const style = [
      `:root{color-scheme:var(--vscode-colorScheme, light dark)}`,
      `body{margin:0;font:12px/1.35 var(--vscode-editor-font-family);color:var(--vscode-foreground);}`,
      `.header{padding:6px 8px;font-weight:600;border-bottom:1px solid var(--vscode-panelSectionHeader-border);}`,
      `#root{padding:6px 4px;}`
    ].join('\n');
    const mathliveCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-static.css')).toString();
    const mathliveFontsCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-fonts.css')).toString();
    const mathliveJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive.min.js')).toString();
    const vegaShimUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vega-shim.js'));
    const vegaLocalFs = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'vega.min.js');
    const interpLocalFs = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'vega-interpreter.min.js');
    const vegaLocalUri = webview.asWebviewUri(vegaLocalFs);
    const interpLocalUri = webview.asWebviewUri(interpLocalFs);
    const inlineJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline.js'));
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
<script nonce="${nonce}" src="${mathliveJs}"></script>
<script nonce="${nonce}" src="${vegaShimUri}" data-vega="${vegaLocalUri}" data-interpreter="${interpLocalUri}"${!allowNet ? ' data-no-network="true"' : ''}></script>
<script nonce="${nonce}" src="${inlineJsUri}"></script>
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
