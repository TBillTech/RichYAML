import * as vscode from 'vscode';

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
}

export function deactivate() {}
