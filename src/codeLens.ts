import * as vscode from 'vscode';
import { findRichNodes, RichNodeInfo, getTagLineForNode } from './yamlService';

/** Register CodeLens for RichYAML nodes: "Preview • Edit" (S2). */
export function registerRichYAMLCodeLens(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: 'yaml' },
    { language: 'richyaml' }
  ];

  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: undefined,
    provideCodeLenses(document) {
      // Cheap pre-check to avoid scanning non-rich files
      const name = document.uri.fsPath.toLowerCase();
      const langOk = document.languageId === 'yaml' || document.languageId === 'richyaml';
      if (!langOk) return [];
      if (!(name.endsWith('.r.yaml') || name.endsWith('.r.yml')) && !/!(equation|chart)\b/.test(document.getText().slice(0, 2000))) {
        return [];
      }
      const text = document.getText();
      const nodes: RichNodeInfo[] = findRichNodes(text);
      const lenses: vscode.CodeLens[] = [];
      for (const n of nodes) {
        const tagLine = getTagLineForNode(text, n);
        const pos = new vscode.Position(tagLine.line, 0);
        const range = new vscode.Range(pos, pos); // lens anchored at tag line
        const args = [document.uri, n.path, n.tag];
        // Preview lens uses our preview command (shows hover at node)
        const preview = new vscode.CodeLens(range, {
          title: 'Preview',
          command: 'richyaml.previewNode',
          arguments: args
        });
        const edit = new vscode.CodeLens(range, {
          title: 'Edit',
          command: 'richyaml.editNodeAtCursor',
          arguments: args
        });
        lenses.push(preview, edit);
      }
      return lenses;
    }
  };

  context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, provider));
}
