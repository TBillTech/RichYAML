import * as vscode from 'vscode';
import { findRichNodes, parseWithTags, RichNodeInfo } from './yamlService';

/** Register Code Actions to edit equation/chart nodes via a compact editor (S1). */
export function registerRichYAMLCodeActions(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: 'yaml' },
    { language: 'richyaml' }
  ];

  const isSelection = (v: vscode.Range | vscode.Selection): v is vscode.Selection => {
    return typeof (v as vscode.Selection).active !== 'undefined';
  };

  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, rangeOrSel, _context, _token) {
      const text = document.getText();
      const nodes = findRichNodes(text);
      const startPos = isSelection(rangeOrSel) ? rangeOrSel.start : rangeOrSel.start;
      const endPos = isSelection(rangeOrSel) ? rangeOrSel.end : rangeOrSel.end;
      const offsetStart = document.offsetAt(startPos);
      const offsetEnd = document.offsetAt(endPos);
      // Find node intersecting selection or starting on the selection line
      let node: RichNodeInfo | undefined = nodes.find(n => !(offsetEnd < n.range.start || offsetStart > n.range.end));
      if (!node) {
        const line = startPos.line;
        node = nodes.find(n => document.positionAt(n.range.start).line === line);
      }
      if (!node) return [];
      const parsed = parseWithTags(text);
      if (!parsed.ok) return [];
      const tag = node.tag === '!equation' ? 'equation' : node.tag === '!chart' ? 'chart' : undefined;
      if (!tag) return [];
      const title = tag === 'equation' ? 'Edit equation…' : 'Edit chart…';
      const ca = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      ca.command = {
        title,
        command: 'richyaml.editNodeAtCursor',
        arguments: [document.uri, node.path, node.tag]
      };
      return [ca];
    }
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    })
  );
}
