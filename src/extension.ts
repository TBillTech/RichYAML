import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { RICHYAML_VERSION } from './version';
import { parseWithTags, findRichNodes, RichNodeInfo, getPropertyValueRange } from './yamlService';

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
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage('Inline previews work in the standard Text Editor. Use "Reopen With..." → "Text Editor" on the file, then toggle again.');
        return;
      }
      inlineController.toggleForActiveEditor();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.showInlinePreviews', () => {
      inlineController.setEnabledForActiveEditor(true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.hideInlinePreviews', () => {
      inlineController.setEnabledForActiveEditor(false);
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

    // Debounced update on document changes to keep webview smooth
    let updateTimer: NodeJS.Timeout | undefined;
    const updateWebview = () => {
      const text = document.getText();
      const parsed = parseWithTags(text);
      if (parsed.ok) {
        webview.postMessage({ type: 'document:update', text, tree: parsed.tree });
      } else {
        webview.postMessage({ type: 'document:update', text, error: parsed.error });
      }
    };
    const scheduleUpdate = () => {
      const cfg = vscode.workspace.getConfiguration('richyaml');
      // Reuse inline debounce setting for custom preview updates as well
      const delay = Math.max(0, Number(cfg.get('preview.inline.debounceMs', 150)) || 0);
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateWebview();
      }, delay);
    };

  const panelTitle = `RichYAML Preview ${RICHYAML_VERSION} (MVP Placeholder)`;
  webviewPanel.title = panelTitle;
  webview.html = this.getHtml(webview, RICHYAML_VERSION);

  const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
    scheduleUpdate();
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
    case 'preview:request':
          updateWebview();
          break;
        case 'data:request': {
          const file = String(msg?.file || '');
          const cfg = vscode.workspace.getConfiguration('richyaml');
          const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
          try {
            const values = await resolveDataFileRelative(document.uri, file, maxPts);
            webview.postMessage({ type: 'data:resolved', path: msg?.path, file, values });
          } catch (e: any) {
            webview.postMessage({ type: 'data:error', path: msg?.path, file, error: e?.message || String(e) });
          }
          break;
        }
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
  statusBar?: vscode.StatusBarItem;
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
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor === vscode.window.activeTextEditor) this.onVisibleRangeChanged(e.textEditor);
      })
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

  setEnabledForActiveEditor(enabled: boolean) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    if (enabled) this.enableForEditor(ed);
    else this.disableForEditor(ed);
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
  const cfg = vscode.workspace.getConfiguration('richyaml');
  const delay = Math.max(0, Number(cfg.get('preview.inline.debounceMs', 150)) || 0);
  if (st.debounce) clearTimeout(st.debounce);
  st.debounce = setTimeout(() => this.renderForEditor(ed), delay);
    }
  }

  private enableForEditor(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    // Clear any existing then mark enabled
    this.cleanupForKey(key);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  status.name = 'RichYAML Previews';
  status.text = '$(preview) Inline Previews: On';
  status.tooltip = 'Click to hide inline previews for this editor';
  status.command = 'richyaml.hideInlinePreviews';
  status.show();
  this.perDocState.set(key, { enabled: true, insets: [], statusBar: status });
    this.renderForEditor(editor);
  }

  private disableForEditor(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    this.cleanupForKey(key);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  status.name = 'RichYAML Previews';
  status.text = '$(preview) Inline Previews: Off';
  status.tooltip = 'Click to show inline previews for this editor';
  status.command = 'richyaml.showInlinePreviews';
  status.show();
  this.perDocState.set(key, { enabled: false, insets: [], statusBar: status });
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
      if (st.statusBar) {
        try { st.statusBar.dispose(); } catch {}
        st.statusBar = undefined;
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
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const maxInsets = Math.max(0, Number(cfg.get('preview.inline.maxInsets', 12)) || 0);
    const bufferLines = Math.max(0, Number(cfg.get('preview.inline.offscreenBufferLines', 20)) || 0);
    const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);

    // Virtualize: only render nodes whose line is in or near visible range
    const visible = editor.visibleRanges?.[0] || new vscode.Range(0,0,Math.min(100, doc.lineCount-1), 0);
    const startLine = Math.max(0, visible.start.line - bufferLines);
    const endLine = Math.min(doc.lineCount - 1, visible.end.line + bufferLines);
    const nodesWithLine = nodes.map((n) => ({ n, line: doc.positionAt(n.range.start).line }));
    const visibleNodes = nodesWithLine.filter(({ line }) => line >= startLine && line <= endLine).slice(0, maxInsets).map(v => v.n);
    const linesWithTags: number[] = visibleNodes
      .map((n) => doc.positionAt(n.range.start).line)
      .filter((ln, idx, arr) => arr.indexOf(ln) === idx)
      .sort((a, b) => a - b);

    // Try proposed API first
    const anyVscode: any = vscode as any;
    const canInset = typeof anyVscode.window?.createWebviewTextEditorInset === 'function';
    if (canInset && parsed.ok) {
      for (const node of visibleNodes) {
        const pos = doc.positionAt(node.range.start);
        const line = pos.line;
        const inset = anyVscode.window.createWebviewTextEditorInset(editor, line, 18, { enableScripts: true, localResourceRoots: [this.context.extensionUri] });
        inset.webview.html = this.buildInlineNodeHtml(inset.webview);
        const dataRaw = this.resolveNodeData(parsed as any, node);
        const data = this.applyDataGuards(dataRaw, maxPts);
        const nodeType = node.tag === '!equation' ? 'equation' : node.tag === '!chart' ? 'chart' : 'unknown';
        const msg = { type: 'preview:init', nodeType, data, path: node.path };
        inset.webview.postMessage(msg);
        // Listen for edits and focus intents from the inset
    const sub = inset.webview.onDidReceiveMessage(async (m: any) => {
          try {
            if (m?.type === 'edit:apply' && Array.isArray(m?.path)) {
              await this.applyInlineEdit(doc, m);
            } else if (m?.type === 'focus:return') {
              // Move focus back to the editor at the start of this line
              try {
                vscode.window.showTextDocument(doc, editor.viewColumn, false).then(() => {
                  const pos = new vscode.Position(line, 0);
                  editor.selection = new vscode.Selection(pos, pos);
                  vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                });
              } catch {}
      } else if (m?.type === 'data:request') {
              const file = String(m?.file || '');
              const cfg = vscode.workspace.getConfiguration('richyaml');
              const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
              try {
                const values = await resolveDataFileRelative(doc.uri, file, maxPts);
                inset.webview.postMessage({ type: 'data:resolved', path: m?.path, file, values });
              } catch (e: any) {
                inset.webview.postMessage({ type: 'data:error', path: m?.path, file, error: e?.message || String(e) });
              }
            }
          } catch (e) {
            console.error('[RichYAML] apply edit failed:', e);
          }
        });
        st.insets.push({ dispose: () => { try { sub.dispose(); } catch {} try { inset.dispose(); } catch {} } });
      }
    } else {
      // Decoration fallback: show an after content marker
      const decoType = this.getOrCreateDecorationType(key);
      const decos: vscode.DecorationOptions[] = linesWithTags.map((line) => ({
        range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
        renderOptions: {
          after: {
            contentText: ' ➶ RichYAML preview',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 0 0 12px'
          }
        }
      }));
      editor.setDecorations(decoType, decos);
      st.decorationType = decoType;
    }
  }

  private onVisibleRangeChanged(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    const st = this.perDocState.get(key);
    if (!st?.enabled) return;
    // Re-render cheaply on scroll
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const delay = Math.max(0, Number(cfg.get('preview.inline.debounceMs', 150)) || 0);
    if (st.debounce) clearTimeout(st.debounce);
    st.debounce = setTimeout(() => this.renderForEditor(editor), Math.min(50, delay));
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
      // Images from extension, data URIs, and https (for potential font sprite assets)
      `img-src ${webview.cspSource} https: data:`,
      // Inline <style> is used for tiny CSS; allow extension and https (MathLive CSS)
      `style-src ${webview.cspSource} https: 'unsafe-inline'`,
      // Only fonts from extension or https
      `font-src ${webview.cspSource} https:`,
      // Only scripts from extension with nonce, plus https (MathLive CDN). No eval.
      `script-src ${webview.cspSource} 'nonce-${nonce}' https:`,
      // Disallow all connections and embeddings
      `connect-src 'none'`,
      `frame-src 'none'`,
      `child-src 'none'`,
      `media-src 'none'`,
      `object-src 'none'`,
      // Base URI not needed
      `base-uri 'none'`,
      // Form posting disabled
      `form-action 'none'`
    ].join('; ');
    return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${mathliveCss}">
<style>${style}</style>
</head><body>
<div id="root" role="group" aria-label="RichYAML inline preview" tabindex="0"></div>
<script nonce="${nonce}" src="${mathliveJs}"></script>
<script nonce="${nonce}" src="${vegaShimUri}"></script>
<script nonce="${nonce}" src="${inlineJsUri}"></script>
</body></html>`;
  }
  private async applyInlineEdit(doc: vscode.TextDocument, msg: any) {
    // Supports:
    // - Equation: { key: 'latex', value }
    // - Chart: { propPath: ['encoding','x','field'], value }
    const nodePath = msg.path as Array<string | number>;
    const propPath: string[] | undefined = Array.isArray(msg.propPath) ? msg.propPath : undefined;
    const editKind = String(msg.edit || 'set');
    if (editKind !== 'set') return;
    const value = msg.value;
    const fullText = doc.getText();

    // Simple schema-ish validation for chart edits
    if (propPath && propPath.length) {
      const top = propPath[0];
      if (top === 'mark') {
        const allowed = new Set(['line','bar','point']);
        if (!allowed.has(String(value).toLowerCase())) return; // ignore invalid
      }
      if ((top === 'encoding') && propPath.length >= 3 && (propPath[2] === 'type')) {
        const allowedTypes = new Set(['quantitative','nominal','temporal','ordinal']);
        if (!allowedTypes.has(String(value).toLowerCase())) return;
      }
    }

    const wsEdit = new vscode.WorkspaceEdit();

    if (!propPath || propPath.length === 0) {
      // Back-compat: single key under node (equation.latex)
      const key = typeof msg.key === 'string' ? msg.key : 'latex';
      const range = getPropertyValueRange(fullText, nodePath, key);
      if (range) {
        const start = doc.positionAt(range.start);
        const end = doc.positionAt(range.end);
        const yamlScalar = JSON.stringify(String(value));
        wsEdit.replace(doc.uri, new vscode.Range(start, end), yamlScalar);
      } else {
        // Insert missing property as scalar under the node map
        const nodes = findRichNodes(fullText);
        const node = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(nodePath));
        const insertPos = node ? doc.positionAt(node.range.start) : new vscode.Position(0, 0);
        const indent = '  ';
        const yamlScalar = JSON.stringify(String(value));
        const insertText = `\n${indent}${key}: ${yamlScalar}`;
        wsEdit.insert(doc.uri, insertPos.translate(1, 0), insertText);
      }
    } else {
      // Nested path set under nodePath (only maps, no arrays for MVP)
      // Try to find deepest existing property value range; otherwise insert new lines progressively.
      const [topKey, ...rest] = propPath;
      const topRange = getPropertyValueRange(fullText, nodePath, topKey);
      if (!rest.length) {
        // Simple property under node
        if (topRange) {
          const start = doc.positionAt(topRange.start);
          const end = doc.positionAt(topRange.end);
          const yamlScalar = JSON.stringify(String(value));
          wsEdit.replace(doc.uri, new vscode.Range(start, end), yamlScalar);
        } else {
          // Insert new top-level property
          const nodes = findRichNodes(fullText);
          const node = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(nodePath));
          const insertPos = node ? doc.positionAt(node.range.start) : new vscode.Position(0, 0);
          const indent = '  ';
          const yamlScalar = JSON.stringify(String(value));
          const insertText = `\n${indent}${topKey}: ${yamlScalar}`;
          wsEdit.insert(doc.uri, insertPos.translate(1, 0), insertText);
        }
      } else {
        // Need to set a nested property (e.g., encoding.x.field)
        // We'll insert minimal structure if missing.
        const text = doc.getText();
        const lines = text.split(/\r?\n/);
        const nodes = findRichNodes(text);
        const node = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(nodePath));
        const anchorPos = node ? doc.positionAt(node.range.start) : new vscode.Position(0,0);
        const anchorLine = anchorPos.line;
        const indent = '  ';
        // Build YAML snippet for missing path
  const snippet = (keys: string[], finalValue: unknown) => {
          let s = '';
          for (let i = 0; i < keys.length - 1; i++) s += `\n${indent.repeat(i+1)}${keys[i]}:`;
          const lastKey = keys[keys.length - 1];
          const scalar = JSON.stringify(String(finalValue));
          s += `\n${indent.repeat(keys.length)}${lastKey}: ${scalar}`;
          return s;
        };
        // Find if topKey exists; if not, insert whole chain
        if (!topRange) {
          const insertText = snippet(propPath, value);
          wsEdit.insert(doc.uri, anchorPos.translate(1, 0), insertText);
        } else if (rest.length === 1) {
          // editing e.g., encoding.title
          const subKey = rest[0];
          const subRange = getPropertyValueRange(fullText, nodePath.concat(topKey as any), subKey);
          if (subRange) {
            const start = doc.positionAt(subRange.start);
            const end = doc.positionAt(subRange.end);
            wsEdit.replace(doc.uri, new vscode.Range(start, end), JSON.stringify(String(value)));
          } else {
            // Insert under existing topKey map
            const topStart = doc.positionAt(topRange.start);
            wsEdit.insert(doc.uri, topStart.translate(1, 0), `\n${indent}${subKey}: ${JSON.stringify(String(value))}`);
          }
        } else {
          // encoding.x.field style nested
          const pathToX = nodePath.concat(topKey as any);
          const xExists = getPropertyValueRange(fullText, pathToX, rest[0]);
          if (!xExists) {
            const insertText = `\n${indent}${rest[0]}:\n${indent.repeat(2)}${rest[1]}: ${JSON.stringify(String(value))}`;
            const topStart = doc.positionAt(topRange.start);
            wsEdit.insert(doc.uri, topStart.translate(1, 0), insertText);
          } else if (rest.length === 2) {
            const fieldRange = getPropertyValueRange(fullText, pathToX.concat(rest[0] as any), rest[1]);
            if (fieldRange) {
              wsEdit.replace(doc.uri, new vscode.Range(doc.positionAt(fieldRange.start), doc.positionAt(fieldRange.end)), JSON.stringify(String(value)));
            } else {
              const xStart = doc.positionAt((xExists as any).start);
              wsEdit.insert(doc.uri, xStart.translate(1, 0), `\n${indent}${rest[1]}: ${JSON.stringify(String(value))}`);
            }
          }
        }
      }
    }

    await vscode.workspace.applyEdit(wsEdit);
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

  private applyDataGuards(data: any, maxPoints: number) {
    if (!data) return data;
    // Truncate chart inline values to maxPoints
    if (data && data.data && Array.isArray(data.data.values)) {
      if (data.data.values.length > maxPoints) {
        data = { ...data, data: { ...data.data, values: data.data.values.slice(0, maxPoints) } };
      }
    }
    return data;
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

/**
 * Resolve a data.file path relative to a document and parse into array of records.
 * Supports CSV, JSON, YAML. Truncates to maxPoints.
 */
async function resolveDataFileRelative(docUri: vscode.Uri, filePath: string, maxPoints: number): Promise<any[]> {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing file');
  let p = filePath.trim();
  if (p.startsWith('file:')) p = p.slice('file:'.length);
  // Normalize separators
  p = p.replace(/\\/g, '/');
  const isAbs = path.isAbsolute(p);
  const baseDir = path.dirname(docUri.fsPath);
  const targetFs = isAbs ? p : path.join(baseDir, p);
  const target = vscode.Uri.file(targetFs);
  let buf: Uint8Array;
  try {
    buf = await vscode.workspace.fs.readFile(target);
  } catch (e: any) {
    throw new Error(`Unable to read ${p}: ${e?.message || e}`);
  }
  const ext = path.extname(target.fsPath).toLowerCase();
  let values: any[] = [];
  try {
    if (ext === '.csv') {
      values = parseCsvToObjects(new TextDecoder('utf-8').decode(buf));
    } else if (ext === '.json') {
      const text = new TextDecoder('utf-8').decode(buf);
      const data = JSON.parse(text);
      if (Array.isArray(data)) values = data;
      else if (data && Array.isArray((data as any).values)) values = (data as any).values;
      else throw new Error('JSON must be an array or an object with a values array');
    } else if (ext === '.yml' || ext === '.yaml') {
      const text = new TextDecoder('utf-8').decode(buf);
      const data = YAML.parse(text);
      if (Array.isArray(data)) values = data;
      else if (data && Array.isArray((data as any).values)) values = (data as any).values;
      else throw new Error('YAML must be an array or an object with a values array');
    } else {
      throw new Error(`Unsupported file type: ${ext || 'unknown'}`);
    }
  } catch (e: any) {
    throw new Error(`Parse error for ${p}: ${e?.message || e}`);
  }
  if (typeof maxPoints === 'number' && maxPoints >= 0 && values.length > maxPoints) {
    values = values.slice(0, maxPoints);
  }
  return values;
}

/** Minimal CSV parser: returns array of objects keyed by header row. */
function parseCsvToObjects(text: string): any[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const header = rows[0];
  const out: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj: any = {};
    for (let j = 0; j < header.length; j++) {
      const k = String(header[j] ?? `col${j + 1}`);
      obj[k] = r[j] ?? '';
    }
    out.push(obj);
  }
  return out;
}

/** CSV to rows with RFC4180-ish quotes, commas, and newlines. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      } else { cell += ch; i++; continue; }
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushCell(); i++; continue; }
      if (ch === '\n') { pushRow(); i++; continue; }
      if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
      cell += ch; i++;
    }
  }
  // trailing cell/row
  pushRow();
  // Trim possible empty last row if file ended with newline
  if (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}
