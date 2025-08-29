import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RICHYAML_VERSION } from './version';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('richyaml.hello', () => {
    vscode.window.showInformationMessage('RichYAML extension is alive.');
  });
  context.subscriptions.push(disposable);

  // State for inline previews per-editor
  const inlineController = new InlinePreviewController(context);
  context.subscriptions.push(inlineController);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.toggleInlinePreviews', () => {
      inlineController.toggleForActiveEditor();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.openCustomPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        'richyaml.editor',
        vscode.ViewColumn.Beside
      );
    })
  );

  // Detect RichYAML files/tags and set a context key for UI/feature gating.
  const setContext = (value: boolean) =>
    vscode.commands.executeCommand('setContext', 'richyaml.isRichYAML', value);

  const richTagRegex = /!(equation|chart)\b/;

  function looksLikeRichYAML(doc: vscode.TextDocument | undefined): boolean {
    if (!doc) return false;
    const isYamlLike = doc.languageId === 'yaml' || doc.languageId === 'richyaml';
    if (!isYamlLike) return false;
    const name = doc.uri.fsPath.toLowerCase();
    if (name.endsWith('.r.yaml') || name.endsWith('.r.yml')) return true;
    // Heuristic: scan for RichYAML tags in the first ~2000 chars to be cheap.
    const text = doc.getText(new vscode.Range(0, 0, Math.min(2000, doc.lineCount), 0));
    return richTagRegex.test(text);
  }

  function refreshActiveContext() {
    const active = vscode.window.activeTextEditor?.document;
    setContext(looksLikeRichYAML(active));
  inlineController.onActiveEditorChanged();
  }

  // Initial evaluation for already-open editors
  refreshActiveContext();

  // Update on editor switch
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshActiveContext())
  );

  // Update on text changes in the active document (debounced micro-task)
  const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === vscode.window.activeTextEditor?.document) {
      // Schedule shortly to allow batching
      setTimeout(refreshActiveContext, 0);
    }
  });
  context.subscriptions.push(changeSub);

  // Also update when documents are opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(() => refreshActiveContext())
  );

  // Register Custom Text Editor provider for RichYAML previews
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'richyaml.editor',
      new RichYAMLCustomEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Try enabling inline previews on activation based on setting
  inlineController.bootstrapFromConfig();
}

export function deactivate() {}

class RichYAMLCustomEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): void | Thenable<void> {
    const { webview } = webviewPanel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    const updateWebview = () => {
      const text = document.getText();
      const parsed = parseWithTags(text);
      if (parsed.ok) {
        webview.postMessage({ type: 'document:update', text, tree: parsed.tree });
      } else {
        webview.postMessage({ type: 'document:update', text, error: parsed.error });
      }
    };

  const panelTitle = `RichYAML Preview ${RICHYAML_VERSION} (MVP Placeholder)`;
  webviewPanel.title = panelTitle;
  webview.html = this.getHtml(webview, RICHYAML_VERSION);

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

  webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
    case 'preview:request':
          updateWebview();
          break;
        default:
          break;
      }
    });

    // Initial render
    updateWebview();
  }

  private getHtml(webview: vscode.Webview, versionLabel: string): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );
    const vegaShimUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vega-shim.js')
    );
    // Optional local vendor fallbacks (if user places files under media/vendor)
    const vegaLocalFs = path.join(this.context.extensionPath, 'media', 'vendor', 'vega.min.js');
    const interpLocalFs = path.join(this.context.extensionPath, 'media', 'vendor', 'vega-interpreter.min.js');
    const hasLocalVega = fs.existsSync(vegaLocalFs);
    const hasLocalInterp = fs.existsSync(interpLocalFs);
    const vegaLocalUri = hasLocalVega
      ? webview.asWebviewUri(vscode.Uri.file(vegaLocalFs))
      : undefined;
    const interpLocalUri = hasLocalInterp
      ? webview.asWebviewUri(vscode.Uri.file(interpLocalFs))
      : undefined;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css')
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      // Allow https for MathLive CSS
      `style-src ${webview.cspSource} https: 'unsafe-inline'`,
      // Allow fonts from extension and https (MathLive)
      `font-src ${webview.cspSource} https:`,
      // Allow our nonce'd script and https (MathLive runtime)
      `script-src ${webview.cspSource} 'nonce-${nonce}' https:`
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RichYAML Preview ${versionLabel}</title>
  <link rel="stylesheet" href="${styleUri}">
  <!-- MathLive CSS (read-only render); TODO: bundle locally in a future task -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive-static.css">
</head>
<body>
  <div class="container">
    <div class="banner">RichYAML Preview ${versionLabel}</div>
    <div id="equations" class="eq-list" aria-label="Rendered equations"></div>
    <div id="charts" class="chart-list" aria-label="Rendered charts"></div>
    <details class="raw-view"><summary>Raw YAML and parsed tree</summary>
      <pre id="content">Loading…</pre>
    </details>
  </div>
  <!-- MathLive runtime (read-only). Note: loaded from CDN for MVP; will be bundled later. -->
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive.min.js"></script>
  <!-- Load Vega shim first to expose window.vega and expressionInterpreter under CSP -->
  <script nonce="${nonce}" src="${vegaShimUri}"${vegaLocalUri ? ` data-vega="${vegaLocalUri}"` : ''}${interpLocalUri ? ` data-interpreter="${interpLocalUri}"` : ''}></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // Version parsing moved to build step via scripts/extract-version.js
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * InlinePreviewController renders lightweight inline previews using Webview insets
 * when available, and falls back to a decoration with after/before content.
 * This is a minimal MVP placeholder; Task 10 will add AST→range mapping.
 */
 class InlinePreviewController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private perDocState = new Map<string, {
    enabled: boolean;
    insets: any[];
    decorationType?: vscode.TextEditorDecorationType;
    debounce?: NodeJS.Timeout;
    lastTextVersion?: number;
  }>();

  private richTagRegex = /!(equation|chart)\b/;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Listen for changes to active editor & documents
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged()),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocChanged(e.document))
    );
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.onDocChanged(doc))
    );
  }

  dispose() {
    for (const d of this.disposables.splice(0)) d.dispose();
    // Dispose all per-doc insets/decorations
    for (const state of this.perDocState.values()) {
      state.insets.forEach(i => i.dispose());
      if (state.decorationType) state.decorationType.dispose();
    }
    this.perDocState.clear();
  }

  bootstrapFromConfig() {
    const mode = vscode.workspace.getConfiguration('richyaml').get<string>('preview.mode', 'inline');
    if (mode === 'inline') {
      const ed = vscode.window.activeTextEditor;
      if (ed && this.isRichYamlDoc(ed.document)) {
        this.enableForEditor(ed);
      }
    }
  }

  toggleForActiveEditor() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const key = ed.document.uri.toString();
    const st = this.perDocState.get(key);
    const currentlyOn = !!st?.enabled;
    if (currentlyOn) this.disableForEditor(ed);
    else this.enableForEditor(ed);
  }

  onActiveEditorChanged() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const key = ed.document.uri.toString();
    const st = this.perDocState.get(key);
    const mode = vscode.workspace.getConfiguration('richyaml').get<string>('preview.mode', 'inline');
    if (st?.enabled) {
      // Re-render on switch to ensure insets attach to correct editor instance
      this.renderForEditor(ed);
    } else if (mode === 'inline' && this.isRichYamlDoc(ed.document)) {
      this.enableForEditor(ed);
    }
  }

  onDocChanged(doc: vscode.TextDocument) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.toString() !== doc.uri.toString()) return;
    const key = doc.uri.toString();
    const st = this.perDocState.get(key);
    if (st?.enabled) {
      if (st.debounce) clearTimeout(st.debounce);
      st.debounce = setTimeout(() => {
        this.renderForEditor(ed);
      }, 120);
    }
  }

  private enableForEditor(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    // Clear any existing then mark enabled
    this.cleanupForKey(key);
    this.perDocState.set(key, { enabled: true, insets: [] });
    this.renderForEditor(editor);
  }

  private disableForEditor(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    this.cleanupForKey(key);
    this.perDocState.set(key, { enabled: false, insets: [] });
    // Also clear decorations
    try {
      editor.setDecorations(this.getOrCreateDecorationType(key), []);
    } catch {}
  }

  private cleanupForKey(key: string) {
    const st = this.perDocState.get(key);
    if (st) {
      st.insets.forEach(i => i.dispose());
      st.insets = [];
      if (st.decorationType) {
        st.decorationType.dispose();
        st.decorationType = undefined;
      }
      if (st.debounce) {
        clearTimeout(st.debounce);
        st.debounce = undefined;
      }
    }
  }

  private isRichYamlDoc(doc: vscode.TextDocument): boolean {
    const isYamlLike = doc.languageId === 'yaml' || doc.languageId === 'richyaml';
    if (!isYamlLike) return false;
    const name = doc.uri.fsPath.toLowerCase();
    if (name.endsWith('.r.yaml') || name.endsWith('.r.yml')) return true;
    const sample = doc.getText(new vscode.Range(0, 0, Math.min(2000, doc.lineCount), 0));
    return this.richTagRegex.test(sample);
  }

  private renderForEditor(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (!this.isRichYamlDoc(doc)) return;
    const key = doc.uri.toString();
    const st = this.perDocState.get(key);
    if (!st || !st.enabled) return;

    // Dispose existing insets before recreating
    st.insets.forEach(i => i.dispose());
    st.insets = [];

  // Use AST→range mapping for accuracy
  const text = doc.getText();
  const nodes: RichNodeInfo[] = findRichNodes(text);
  const parsed = parseWithTags(text);
    const linesWithTags: number[] = nodes
      .map((n) => doc.positionAt(n.range.start).line)
      .filter((ln, idx, arr) => arr.indexOf(ln) === idx)
      .sort((a, b) => a - b);

    if (typeof (vscode.window as any).createWebviewTextEditorInset === 'function') {
      // Use insets with per-node inline webviews
  for (const node of nodes) {
        const startLine = doc.positionAt(node.range.start).line;
        const inset: any = (vscode.window as any).createWebviewTextEditorInset(editor, startLine, 92, {
          enableScripts: true
        });
        inset.webview.options = {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri, vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };
        inset.webview.html = this.buildInlineNodeHtml(inset.webview);
  const nodeType = node.tag === '!equation' ? 'equation' : 'chart';
  const data = this.resolveNodeData(parsed, node) ?? this.extractInlineNodeData(doc, node);
  inset.webview.postMessage({ type: 'preview:init', nodeType, data });
        st.insets.push(inset);
      }
      if (st.decorationType) editor.setDecorations(st.decorationType, []);
    } else {
      // Decoration fallback: show an after content marker
      const decoType = this.getOrCreateDecorationType(key);
      const decos: vscode.DecorationOptions[] = linesWithTags.map((line) => ({
        range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
        renderOptions: {
          after: {
            contentText: ' ⟶ RichYAML preview',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 0 0 12px'
          }
        }
      }));
      editor.setDecorations(decoType, decos);
      st.decorationType = decoType;
    }
  }

  private buildInlineNodeHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const style = [
      `:root{color-scheme:var(--vscode-colorScheme, light dark)}`,
      `body{margin:0;font:12px/1.4 var(--vscode-editor-font-family);color:var(--vscode-foreground);}`,
      `.ry-title{font-weight:600;margin:6px 8px 4px 8px}`,
      `.ry-body{margin:0 8px 8px 8px}`,
      `.ry-json{max-height:160px;overflow:auto;background:var(--vscode-editor-inactiveSelectionBackground);padding:6px;border-radius:4px}`,
      `.ry-chart{min-height:80px}`
    ].join('\n');
    const mathliveCss = `https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive-static.css`;
    const mathliveJs = `https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive.min.js`;
    const vegaShimUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vega-shim.js'));
    const inlineJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline.js'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} https: 'unsafe-inline'`,
      `font-src ${webview.cspSource} https:`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' https:`
    ].join('; ');
    return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${mathliveCss}">
<style>${style}</style>
</head><body>
<div id="root"></div>
<script nonce="${nonce}" src="${mathliveJs}"></script>
<script nonce="${nonce}" src="${vegaShimUri}"></script>
<script nonce="${nonce}" src="${inlineJsUri}"></script>
</body></html>`;
  }
  private resolveNodeData(parsed: ReturnType<typeof parseWithTags>, node: RichNodeInfo): any | undefined {
    if (!parsed || !('ok' in parsed) || !parsed.ok) return undefined;
    const tree: any = parsed.tree as any;
    // Walk path
    let cur: any = tree;
    for (const seg of node.path) {
      if (cur == null) break;
      if (typeof seg === 'number') {
        const arr = Array.isArray(cur) ? cur : Array.isArray(cur?.$items) ? cur.$items : undefined;
        if (!arr || seg < 0 || seg >= arr.length) { cur = undefined; break; }
        cur = arr[seg];
      } else {
        cur = cur?.[seg];
      }
    }
    if (!cur || typeof cur !== 'object') return undefined;
    const tag = (cur.$tag || '').toString();
    if (tag !== node.tag) return undefined;
    // Normalize payloads for inline renderer
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

  private extractInlineNodeData(doc: vscode.TextDocument, node: RichNodeInfo): any {
    // Minimal, safe data projection: just send shallow YAML block via text heuristics is unreliable.
    // Better: parse the whole document once and pluck by path — TODO for Task 12.
    const line = doc.positionAt(node.range.start).line;
    const text = doc.getText(new vscode.Range(line, 0, Math.min(line + 50, doc.lineCount - 1), 0));
    if (node.tag === '!equation') {
      return { desc: undefined, latex: undefined, mathjson: undefined, _raw: text };
    }
    if (node.tag === '!chart') {
      return { title: undefined, mark: undefined, encoding: undefined, data: undefined, _raw: text };
    }
    return { _raw: text };
  }
  private getOrCreateDecorationType(key: string): vscode.TextEditorDecorationType {
    const existing = this.perDocState.get(key)?.decorationType;
    if (existing) return existing;
    const type = vscode.window.createTextEditorDecorationType({});
    return type;
  }
}
