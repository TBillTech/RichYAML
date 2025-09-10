import * as vscode from 'vscode';
import { findRichNodes, getTagLineForNode } from './yamlService';

/** Lightweight gutter badges for !equation and !chart nodes. */
export function registerGutterBadges(context: vscode.ExtensionContext) {
  const eqIcon = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'equation.svg');
  const chartIcon = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'chart.svg');

  const eqDeco = vscode.window.createTextEditorDecorationType({
    gutterIconPath: eqIcon,
    gutterIconSize: 'contain'
  });
  const chartDeco = vscode.window.createTextEditorDecorationType({
    gutterIconPath: chartIcon,
    gutterIconSize: 'contain'
  });
  context.subscriptions.push(eqDeco, chartDeco);

  const applyForEditor = (editor?: vscode.TextEditor) => {
    if (!editor) return;
    const doc = editor.document;
    if (!(doc.languageId === 'yaml' || doc.languageId === 'richyaml')) {
      editor.setDecorations(eqDeco, []);
      editor.setDecorations(chartDeco, []);
      return;
    }
    const text = doc.getText();
    // Quick heuristic gating
    if (!/!(equation|chart)\b/.test(text)) {
      editor.setDecorations(eqDeco, []);
      editor.setDecorations(chartDeco, []);
      return;
    }
    const nodes = findRichNodes(text);
    const eqRanges: vscode.Range[] = [];
    const chartRanges: vscode.Range[] = [];
    for (const n of nodes) {
      const tagLine = getTagLineForNode(text, n);
      const r = new vscode.Range(tagLine.line, 0, tagLine.line, 0);
      if (n.tag === '!equation') eqRanges.push(r);
      else if (n.tag === '!chart') chartRanges.push(r);
    }
    editor.setDecorations(eqDeco, eqRanges);
    editor.setDecorations(chartDeco, chartRanges);
  };

  // Initial & active editor
  applyForEditor(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => applyForEditor(ed)),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
      if (ed) applyForEditor(ed);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.visibleTextEditors.find(x => x.document.uri.toString() === e.document.uri.toString());
      if (ed) applyForEditor(ed);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => applyForEditor(e.textEditor))
  );
}
