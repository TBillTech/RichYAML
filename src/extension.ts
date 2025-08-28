import * as vscode from 'vscode';
import { RICHYAML_VERSION } from './version';
import { parseWithTags } from './yamlService';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('richyaml.hello', () => {
    vscode.window.showInformationMessage('RichYAML extension is alive.');
  });
  context.subscriptions.push(disposable);

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
      `script-src 'nonce-${nonce}' https:`
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
    <details class="raw-view"><summary>Raw YAML and parsed tree</summary>
      <pre id="content">Loading…</pre>
    </details>
  </div>
  <!-- MathLive runtime (read-only). Note: loaded from CDN for MVP; will be bundled later. -->
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive.min.js"></script>
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
