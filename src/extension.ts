import * as vscode from 'vscode';
import { registerRichYAMLHover } from './hover';
import { registerChartCache } from './chartCache';
import { registerChartPreRenderer } from './preRender';
import { registerRichYAMLCodeActions } from './codeActions';
import { registerRichYAMLCodeLens } from './codeLens';
import { registerGutterBadges } from './gutter';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { RICHYAML_VERSION } from './version';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';
import { applyRichNodeEdit } from './applyEdits';
import { validateEquation, validateChart } from './validation';
import { RichYAMLViewProvider } from './sidePreview';

export function activate(context: vscode.ExtensionContext) {
  // Track short-lived timers created at activation scope, so we can clear on dispose
  const actTimers = new Set<NodeJS.Timeout>();
  context.subscriptions.push(new vscode.Disposable(() => { try { for (const t of Array.from(actTimers)) clearTimeout(t); } catch {} actTimers.clear(); }));
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

  // Focus the side preview view if present
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.showSidePreview', async () => {
      try { await vscode.commands.executeCommand('workbench.view.explorer'); } catch {}
      try { await vscode.commands.executeCommand('workbench.views.service.refreshView', 'richyaml.sidePreview'); } catch {}
      try { await vscode.commands.executeCommand('workbench.views.focusView', 'richyaml.sidePreview'); } catch {}
    })
  );

  // Toggle side panel mode (edit <-> preview)
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.toggleSidePanelMode', async () => {
      const cfg = vscode.workspace.getConfiguration('richyaml');
      const cur = cfg.get<string>('sidePanel.mode', 'edit');
      const next = cur === 'edit' ? 'preview' : 'edit';
      await cfg.update('sidePanel.mode', next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`RichYAML side panel mode: ${next}`, 2500);
      try { await vscode.commands.executeCommand('workbench.views.service.refreshView', 'richyaml.sidePreview'); } catch {}
    })
  );

  // React to configuration changes that affect side panel rendering
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('richyaml.sidePanel.mode') || e.affectsConfiguration('richyaml.sidePreview.contextWindow')) {
        try { vscode.commands.executeCommand('workbench.views.service.refreshView', 'richyaml.sidePreview'); } catch {}
      }
    })
  );

  // Detect RichYAML files/tags and set a context key for UI/feature gating.
  const setContext = (value: boolean) =>
    vscode.commands.executeCommand('setContext', 'richyaml.isRichYAML', value);

  const richTagRegex = /!(equation|chart)\b/;

  function looksLikeRichYAML(doc: vscode.TextDocument | undefined): boolean {
    if (!doc) return false;
  // If explicitly in 'richyaml' language mode, treat as RichYAML.
  if (doc.languageId === 'richyaml') return true;
  const isYamlLike = doc.languageId === 'yaml';
  if (!isYamlLike) return false;
    const name = doc.uri.fsPath.toLowerCase();
    if (name.endsWith('.r.yaml') || name.endsWith('.r.yml')) return true;
  // Heuristic: scan for RichYAML tags in the first ~2000 chars to be cheap.
  // Use character slicing instead of a line-based range to avoid off-by-one issues.
  const text = doc.getText().slice(0, 2000);
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
  const h = setTimeout(() => { try { refreshActiveContext(); } finally { actTimers.delete(h); } }, 0);
  actTimers.add(h);
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

  // Initialize chart cache invalidation hooks
  try { registerChartCache(context); } catch {}
  // Start background pre-renderer to warm chart SVG cache
  try { registerChartPreRenderer(context); } catch {}

  // Register hover provider for YAML/richyaml
  try { registerRichYAMLHover(context); } catch {}

  // Register code actions for S1 and the edit command
  try { registerRichYAMLCodeActions(context); } catch {}
  // Register CodeLens (S2)
  try { registerRichYAMLCodeLens(context); } catch {}
  // Register gutter badges (S2)
  try { registerGutterBadges(context); } catch {}
  // Register side preview view (S3)
  try {
    console.log('[RichYAML] Registering side preview WebviewViewProvider...');
    const provider = new RichYAMLViewProvider(context);
    context.subscriptions.push(provider);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(RichYAMLViewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })
    );
    console.log('[RichYAML] Side preview WebviewViewProvider registered.');
  } catch (e) {
    console.error('[RichYAML] Failed to register side preview provider:', e);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('richyaml.editNodeAtCursor', async (uri?: vscode.Uri, pathSegs?: Array<string|number>, tag?: string) => {
      const editor = vscode.window.activeTextEditor;
      const doc = editor?.document ?? (uri ? await vscode.workspace.openTextDocument(uri) : undefined);
      if (!doc) return;
      const nodePath: Array<string|number> = Array.isArray(pathSegs) ? pathSegs : [];
      const nodeType = tag === '!chart' ? 'chart' : 'equation';
      const panel = vscode.window.createWebviewPanel(
        'richyaml.miniEditor',
        nodeType === 'equation' ? 'Edit Equation' : 'Edit Chart',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        }
      );
      const allowNet = !!vscode.workspace.getConfiguration('richyaml').get('security.allowNetworkResources', false);
  const inlineHtml = buildSingleNodeHtml(context, panel.webview, allowNet);
      panel.webview.html = inlineHtml;
      // Seed initial payload using existing parse + projection helpers
      const text = doc.getText();
      const nodes = findRichNodes(text);
      const parsed = parseWithTags(text);
      const target = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(nodePath)) ?? nodes[0];
      if (target && parsed.ok) {
        const data = getNodePayloadFromTree(parsed.tree as any, target);
        const issues = nodeType === 'equation' ? validateEquation(data) : nodeType === 'chart' ? validateChart(data) : [];
        const payload = { type: 'preview:init', nodeType: nodeType, data, path: target.path, issues };
        panel.webview.postMessage(payload);
      }
      // Handle edits and data requests similarly to inline insets
      const sub = panel.webview.onDidReceiveMessage(async (m) => {
        if (m?.type === 'edit:apply') {
          await applyRichNodeEdit(doc, m);
        } else if (m?.type === 'data:request') {
          try {
            const values = await resolveDataFileRelative(doc.uri, String(m.file || ''), Number(vscode.workspace.getConfiguration('richyaml').get('preview.inline.maxDataPoints', 1000)) || 0);
            panel.webview.postMessage({ type: 'data:resolved', path: m?.path, file: m?.file, values });
          } catch (e: any) {
            panel.webview.postMessage({ type: 'data:error', path: m?.path, file: m?.file, error: e?.message || String(e) });
          }
        }
      });
      panel.onDidDispose(() => { try { sub.dispose(); } catch {} });
    })
  );

  // Preview command for CodeLens: momentarily show hover at node line
  context.subscriptions.push(
  vscode.commands.registerCommand('richyaml.previewNode', async (uri?: vscode.Uri, pathSegs?: Array<string|number>, tag?: string) => {
      try {
        const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
        if (!doc) return;
        const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        const text = doc.getText();
        const nodes = findRichNodes(text);
        const pathKey = JSON.stringify(Array.isArray(pathSegs) ? pathSegs : []);
        const node = nodes.find(n => JSON.stringify(n.path) === pathKey) || nodes[0];
        if (!node) return;
        const pos = doc.positionAt(node.range.start);
        const range = new vscode.Range(pos, pos);
    // Move cursor, reveal, and trigger hover
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    await vscode.commands.executeCommand('editor.action.showHover');
      } catch {}
    })
  );
}

export function deactivate() {}

class RichYAMLCustomEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): void | Thenable<void> {
    const { webview } = webviewPanel;
  const cfg = vscode.workspace.getConfiguration('richyaml');
  const allowNet = !!cfg.get('security.allowNetworkResources', false);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
    vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    // Debounced update on document changes to keep webview smooth
    let updateTimer: NodeJS.Timeout | undefined;
    let disposed = false;
    const updateWebview = () => {
      if (disposed) return;
      const text = document.getText();
      const parsed = parseWithTags(text);
      if (parsed.ok) {
        safePostMessage(webview, { type: 'document:update', text, tree: parsed.tree });
      } else {
        safePostMessage(webview, { type: 'document:update', text, error: parsed.error });
      }
    };
    const scheduleUpdate = () => {
      if (disposed) return;
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
  webview.html = this.getHtml(webview, RICHYAML_VERSION, allowNet);

  const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
    scheduleUpdate();
      }
    });
  webviewPanel.onDidDispose(() => { disposed = true; try { changeSub.dispose(); } catch {} if (updateTimer) { try { clearTimeout(updateTimer); } catch {} updateTimer = undefined; } });

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
      safePostMessage(webview, { type: 'data:resolved', path: msg?.path, file, values });
          } catch (e: any) {
      safePostMessage(webview, { type: 'data:error', path: msg?.path, file, error: e?.message || String(e) });
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

  private getHtml(webview: vscode.Webview, versionLabel: string, allowNet: boolean): string {
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
    const mathliveJsLocal = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive.min.js')
    );
    const mathliveCssLocal = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-static.css')
    );
    const mathliveFontsCssLocal = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-fonts.css')
    );

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

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RichYAML Preview ${versionLabel}</title>
  <link rel="stylesheet" href="${styleUri}">
  <!-- Local MathLive CSS + fonts -->
  <link rel="stylesheet" href="${mathliveFontsCssLocal}">
  <link rel="stylesheet" href="${mathliveCssLocal}">
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
  <script nonce="${nonce}" src="${mathliveJsLocal}"></script>
  <!-- Load Vega shim first to expose window.vega and expressionInterpreter under CSP -->
  <script nonce="${nonce}" src="${vegaShimUri}"${vegaLocalUri ? ` data-vega="${vegaLocalUri}"` : ''}${interpLocalUri ? ` data-interpreter="${interpLocalUri}"` : ''}${!allowNet ? ' data-no-network="true"' : ''}></script>
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

// Post a message to a webview and swallow rejections (e.g., when disposed) to avoid unhandled promise rejections.
function safePostMessage(webview: vscode.Webview, msg: any): void {
  try {
    void webview.postMessage(msg).then(() => {}, () => {});
  } catch {
    // ignore
  }
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
    // Reuse insets per node path to avoid churn and listener leaks
    insets: Map<string, { line: number; dispose: () => void; post: (msg: any) => Thenable<boolean> } >;
    decorationType?: vscode.TextEditorDecorationType;
    debounce?: NodeJS.Timeout;
    lastTextVersion?: number;
    lastVisible?: { start: number; end: number };
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
  setTimeout(() => { try { this.renderForEditor(ed); } catch {} }, 150);
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
  this.perDocState.set(key, { enabled: true, insets: new Map(), statusBar: status });
  this.renderForEditor(editor);
  setTimeout(() => { try { this.renderForEditor(editor); } catch {} }, 150);
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
  this.perDocState.set(key, { enabled: false, insets: new Map(), statusBar: status });
    // Also clear decorations
    try {
      editor.setDecorations(this.getOrCreateDecorationType(key), []);
    } catch {}
  }

  private cleanupForKey(key: string) {
    const st = this.perDocState.get(key);
    if (st) {
      st.insets.forEach(i => { try { i.dispose(); } catch {} });
      st.insets.clear();
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
      st.lastVisible = undefined;
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
    const anyVscode: any = vscode as any;
    const allowProposed = !!vscode.workspace
      .getConfiguration('richyaml')
      .get('preview.inline.experimentalInsets', false);
    const canInset = allowProposed && typeof anyVscode.window?.createWebviewTextEditorInset === 'function';

  // Use AST→range mapping for accuracy
  const text = doc.getText();
  const nodes: RichNodeInfo[] = findRichNodes(text);
  const parsed = parseWithTags(text);
  if (!parsed.ok) {
    // Send parse error to all existing insets (so they show banner) and dispose stale ones
    for (const [, inset] of Array.from(st.insets.entries())) {
      try { inset.post({ type: 'preview:error', error: 'Invalid YAML: ' + parsed.error }); } catch {}
    }
    return; // do not attempt rendering
  }
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

    // Try proposed API first, reusing insets
  if (canInset && parsed.ok) {
      const nextKeys = new Set<string>();
      for (const node of visibleNodes) {
        const keyPath = JSON.stringify(node.path);
        nextKeys.add(keyPath);
        const cur = st.insets.get(keyPath);
        const pos = doc.positionAt(node.range.start);
        const line = pos.line;
        const nodeType = node.tag === '!equation' ? 'equation' : node.tag === '!chart' ? 'chart' : 'unknown';
        const dataRaw = this.resolveNodeData(parsed as any, node);
        const data = this.applyDataGuards(dataRaw, maxPts);
  const issues = nodeType === 'equation' ? validateEquation(data) : nodeType === 'chart' ? validateChart(data) : [];
  const payload = { type: cur ? 'preview:update' : 'preview:init', nodeType, data, path: node.path, issues };

  if (cur && cur.line === line) {
          // Reuse existing inset, just update (fire and forget)
      try { cur.post(payload); } catch {}
        } else {
          // Need to (re)create
          if (cur) { try { cur.dispose(); } catch {} st.insets.delete(keyPath); }
          // Start with a very small height; we'll resize after measuring content
          // Use a slightly larger initial height for charts
          const initialLines = nodeType === 'chart' ? 12 : 3;
          const inset = anyVscode.window.createWebviewTextEditorInset(editor, line, initialLines, { enableScripts: true, localResourceRoots: [this.context.extensionUri] });
          inset.webview.html = this.buildInlineNodeHtml(inset.webview);
    const sub = inset.webview.onDidReceiveMessage(async (m: any) => {
            try {
              if (m?.type === 'edit:apply' && Array.isArray(m?.path)) {
                await applyRichNodeEdit(doc, m);
              } else if (m?.type === 'focus:return') {
                try {
                  vscode.window.showTextDocument(doc, editor.viewColumn, false).then(() => {
                    const pos2 = new vscode.Position(line, 0);
                    editor.selection = new vscode.Selection(pos2, pos2);
                    vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                  });
                } catch {}
      } else if (m?.type === 'size' && (typeof m?.heightPx === 'number' || typeof m?.height === 'number')) {
        // Convert pixel height from webview to editor line units
        const px = Math.floor(Number(m.heightPx ?? m.height));
        const lines = this.pxToEditorLines(px, editor);
        // Clamp based on node type: equations are compact, charts can be taller
        const minL = nodeType === 'chart' ? 6 : 1;
        const maxL = nodeType === 'chart' ? 40 : 12;
        const clamped = Math.max(minL, Math.min(maxL, lines));
        try { inset.height = clamped; } catch {}
              } else if (m?.type === 'data:request') {
                const file = String(m?.file || '');
                const cfg2 = vscode.workspace.getConfiguration('richyaml');
                const maxPts2 = Math.max(0, Number(cfg2.get('preview.inline.maxDataPoints', 1000)) || 0);
                try {
                  const values = await resolveDataFileRelative(doc.uri, file, maxPts2);
      safePostMessage(inset.webview, { type: 'data:resolved', path: m?.path, file, values });
                } catch (e: any) {
      safePostMessage(inset.webview, { type: 'data:error', path: m?.path, file, error: e?.message || String(e) });
                }
              }
            } catch (e) {
              console.error('[RichYAML] inline message failed:', e);
            }
          });
          // Send initial payload
    safePostMessage(inset.webview, payload);
      st.insets.set(keyPath, { line, dispose: () => { try { sub.dispose(); } catch {} try { inset.dispose(); } catch {} }, post: (msg) => inset.webview.postMessage(msg).then(() => true, () => false) });
        }
      }
      // Dispose any insets not needed
      for (const [k, v] of Array.from(st.insets.entries())) {
        if (!nextKeys.has(k)) { try { v.dispose(); } catch {} st.insets.delete(k); }
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

    st.lastTextVersion = doc.version;
    st.lastVisible = { start: startLine, end: endLine };
  }

  private onVisibleRangeChanged(editor: vscode.TextEditor) {
    const key = editor.document.uri.toString();
    const st = this.perDocState.get(key);
    if (!st?.enabled) return;
    // Re-render cheaply on scroll
    const visible = editor.visibleRanges?.[0];
    if (!visible) return;
    const cur = { start: visible.start.line, end: visible.end.line };
    const prev = st.lastVisible;
    // Only update if we moved > 2 lines or ranges don’t overlap
    const movedEnough = !prev || Math.abs(cur.start - prev.start) > 2 || Math.abs(cur.end - prev.end) > 2;
    if (!movedEnough) return;
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const delay = Math.max(0, Number(cfg.get('preview.inline.debounceMs', 150)) || 0);
    if (st.debounce) clearTimeout(st.debounce);
    st.debounce = setTimeout(() => this.renderForEditor(editor), Math.max(100, Math.min(300, delay)));
  }

  private buildInlineNodeHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const allowNet = !!cfg.get('security.allowNetworkResources', false);
    const style = [
      `:root{color-scheme:var(--vscode-colorScheme, light dark)}`,
  `body{margin:0;font:12px/1.35 var(--vscode-editor-font-family);color:var(--vscode-foreground);}`,
  `.ry-title{font-weight:600;margin:2px 6px 2px 6px}`,
  `.ry-body{margin:0 6px 4px 6px}`,
  `.ry-body-eq{padding:0; margin:0 6px 2px 6px}`,
  `.ry-body-eq math-field{display:inline-block; min-height:0; padding:0; --ML__spacing:0; line-height:1;}`,
  `.ry-body-chart{margin-top:4px}`,
      `.ry-json{max-height:160px;overflow:auto;background:var(--vscode-editor-inactiveSelectionBackground);padding:6px;border-radius:4px}`,
      `.ry-chart{min-height:80px}`
    ].join('\n');
  const mathliveCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-static.css')).toString();
  const mathliveFontsCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive-fonts.css')).toString();
  const mathliveJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'mathlive.min.js')).toString();
  const vegaShimUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vega-shim.js'));
  // Prefer local vendor bundles if available (built by prebuild script)
  const vegaLocalFs = path.join(this.context.extensionPath, 'media', 'vendor', 'vega.min.js');
  const interpLocalFs = path.join(this.context.extensionPath, 'media', 'vendor', 'vega-interpreter.min.js');
  const hasLocalVega = fs.existsSync(vegaLocalFs);
  const hasLocalInterp = fs.existsSync(interpLocalFs);
  const vegaLocalUri = hasLocalVega ? webview.asWebviewUri(vscode.Uri.file(vegaLocalFs)) : undefined;
  const interpLocalUri = hasLocalInterp ? webview.asWebviewUri(vscode.Uri.file(interpLocalFs)) : undefined;
    const inlineJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline.js'));
    const csp = [
      `default-src 'none'`,
      // Images from extension, data URIs, and https (for potential font sprite assets)
      `img-src ${webview.cspSource} ${allowNet ? 'https:' : ''} data:`,
      // Inline <style> is used for tiny CSS; allow extension and https (MathLive CSS)
      `style-src ${webview.cspSource} ${allowNet ? 'https:' : ''} 'unsafe-inline'`,
      // Only fonts from extension or https
      `font-src ${webview.cspSource} ${allowNet ? 'https:' : ''}`,
      // Only scripts from extension with nonce, plus https (MathLive CDN). No eval.
      `script-src ${webview.cspSource} 'nonce-${nonce}' ${allowNet ? 'https:' : ''}`,
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
<link rel="stylesheet" href="${mathliveFontsCss}">
<link rel="stylesheet" href="${mathliveCss}">
<style>${style}</style>
</head><body>
<div id="root" role="group" aria-label="RichYAML inline preview" tabindex="0"></div>
<script nonce="${nonce}" src="${mathliveJs}"></script>
<script nonce="${nonce}" src="${vegaShimUri}"${vegaLocalUri ? ` data-vega="${vegaLocalUri}"` : ''}${interpLocalUri ? ` data-interpreter="${interpLocalUri}"` : ''}${!allowNet ? ' data-no-network="true"' : ''}></script>
<script nonce="${nonce}" src="${inlineJsUri}"></script>
</body></html>`;
  }

  // Convert pixel height from webview content to editor inset line units
  private pxToEditorLines(px: number, editor: vscode.TextEditor): number {
    // Try user/editor config; fall back to a reasonable default
    const cfg = vscode.workspace.getConfiguration('editor', editor.document);
    let lineHeightCfg = Number(cfg.get('lineHeight', 0)) || 0; // 0 means compute
    const fontSize = Math.max(8, Number(cfg.get('fontSize', 14)) || 14);
    // VS Code computes line height roughly ~1.35 * fontSize when 0
    const lineHeightPx = lineHeightCfg > 0 ? lineHeightCfg : Math.round(fontSize * 1.35);
    const lines = Math.ceil(px / Math.max(8, lineHeightPx));
    return Math.max(1, lines);
  }
  // Editing logic refactored into shared applyRichNodeEdit (see applyEdits.ts)
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

// Build a minimal HTML using the same inline renderer bundle for a single-node mini editor
function buildSingleNodeHtml(context: vscode.ExtensionContext, webview: vscode.Webview, allowNet: boolean): string {
  // Reuse InlinePreviewController.buildInlineNodeHtml to keep styles/assets consistent
  const tmp = new (InlinePreviewController as any)(context);
  try {
    // Temporarily toggle the allowNet setting via parameter by reading inside method; we pass through CSP attributes accordingly
    return (tmp as any).buildInlineNodeHtml(webview);
  } catch {
    // Fallback simple HTML
    const nonce = getNonce();
    const inlineJsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'inline.js'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} ${allowNet ? 'https:' : ''} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
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
    return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><div id="root"></div><script nonce="${nonce}" src="${inlineJsUri}"></script></body></html>`;
  } finally {
    try { tmp.dispose?.(); } catch {}
  }
}

// Walk parsed tree (from parseWithTags) to get normalized node payload, similar to hover.ts
function getNodePayloadFromTree(tree: any, node: RichNodeInfo): any | undefined {
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

/**
 * Resolve a data.file path relative to a document and parse into array of records.
 * Supports CSV, JSON, YAML. Truncates to maxPoints.
 */
async function resolveDataFileRelative(docUri: vscode.Uri, filePath: string, maxPoints: number): Promise<any[]> {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing file');
  let p = filePath.trim();
  if (/^https?:/i.test(p)) throw new Error('Network URLs are not allowed');
  if (p.startsWith('file:')) p = p.slice('file:'.length);
  // Normalize separators
  p = p.replace(/\\/g, '/');
  const isAbs = path.isAbsolute(p);
  const baseDir = path.dirname(docUri.fsPath);
  const targetFs = isAbs ? p : path.join(baseDir, p);
  const targetFsResolved = path.resolve(targetFs);
  // Enforce workspace boundary unless opted out
  const allowOutside = !!vscode.workspace.getConfiguration('richyaml').get('security.allowDataOutsideWorkspace', false);
  const wsFolder = vscode.workspace.getWorkspaceFolder(docUri);
  if (wsFolder && !allowOutside) {
    const wsRoot = path.resolve(wsFolder.uri.fsPath) + path.sep;
    if (!targetFsResolved.startsWith(wsRoot)) {
      throw new Error('Data path must be inside the current workspace');
    }
  }
  const target = vscode.Uri.file(targetFsResolved);
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
