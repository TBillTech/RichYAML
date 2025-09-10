import * as vscode from 'vscode';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';

/** Register rich hovers for YAML and RichYAML files. */
export function registerRichYAMLHover(context: vscode.ExtensionContext) {
	const selector: vscode.DocumentSelector = [
		{ language: 'yaml' },
		{ language: 'richyaml' }
	];

	const provider: vscode.HoverProvider = {
		provideHover(document, position, _token) {
			// Fast check: look for a tagged node under cursor
			const text = document.getText();
			const offset = document.offsetAt(position);
			const nodes = findRichNodes(text);
			let node = nodes.find(n => offset >= n.range.start && offset <= n.range.end);
			if (!node) {
				// Fallback: if hovering on the tag line or key next to it, match node starting on this line
				const hoverLine = position.line;
				node = nodes.find(n => document.positionAt(n.range.start).line === hoverLine);
			}
			if (!node) {
				// Last-resort regex hover so users see something even if parsing failed
				const lineText = document.lineAt(position.line).text;
				const m = /!(equation|chart)\b/i.exec(lineText);
				if (!m) return undefined;
				const kind = m[1].toLowerCase();
				// Try to resolve the concrete node on this line or the immediate next line
				const startLine = position.line;
				node = nodes.find(n => {
					const l = document.positionAt(n.range.start).line;
					return (l === startLine || l === startLine + 1) && n.tag.toLowerCase() === `!${kind}`;
				});
				if (!node) {
					// Could not resolve a specific node; show minimal fallback
					const md = new vscode.MarkdownString(undefined, true);
					md.supportHtml = false; md.isTrusted = false;
					md.appendMarkdown(kind === 'equation' ? 'Equation' : 'Chart');
					md.appendMarkdown('\n\n');
					md.appendMarkdown('_Parsing in progress or unavailable_');
					return new vscode.Hover(md, document.lineAt(position.line).range);
				}
			}

			const parsed = parseWithTags(text);
			const payload = parsed.ok ? getNodePayload(parsed.tree as any, node) : undefined;

			const md = new vscode.MarkdownString(undefined, true);
			md.isTrusted = false;
			md.supportHtml = false;

			// Title header
			if (node.tag === '!equation') {
				md.appendMarkdown('Equation');
			} else if (node.tag === '!chart') {
				md.appendMarkdown('Chart');
			} else {
				md.appendMarkdown('RichYAML');
			}
			md.appendMarkdown('\n\n');

			if (node.tag === '!equation') {
				const latex = (payload as any)?.latex as string | undefined;
				const desc = (payload as any)?.desc as string | undefined;
				if (desc) md.appendMarkdown(`**${escapeMd(desc)}**\n\n`);
				if (latex) {
					md.appendCodeblock(latex, 'latex');
				} else if ((payload as any)?.mathjson) {
					const json = safeJson((payload as any).mathjson);
					md.appendCodeblock(json, 'json');
				} else {
					md.appendMarkdown('_No equation details available_');
				}
			} else if (node.tag === '!chart') {
				const title = (payload as any)?.title as string | undefined;
				const mark = (payload as any)?.mark as string | undefined;
				const enc = (payload as any)?.encoding as any | undefined;
				const x = enc?.x; const y = enc?.y;
				if (title) md.appendMarkdown(`**${escapeMd(title)}**\n\n`);
				if (mark) md.appendMarkdown('- Mark: `' + escapeMd(String(mark)) + '`\n');
				if (x) md.appendMarkdown('- X: field=`' + escapeMd(String(x.field ?? '')) + '`, type=`' + escapeMd(String(x.type ?? '')) + '`\n');
				if (y) md.appendMarkdown('- Y: field=`' + escapeMd(String(y.field ?? '')) + '`, type=`' + escapeMd(String(y.type ?? '')) + '`\n');
				if (!title && !mark && !x && !y) {
					const json = safeJson(payload);
					md.appendCodeblock(json, 'yaml');
				}
			} else {
				md.appendMarkdown('_Unsupported rich node_');
			}

			const range = new vscode.Range(
				document.positionAt(node.range.start),
				document.positionAt(node.range.end)
			);
			return new vscode.Hover(md, range);
		}
	};

	const disposable = vscode.languages.registerHoverProvider(selector, provider);
	context.subscriptions.push(disposable);
}

function getNodePayload(tree: any, node: RichNodeInfo): any | undefined {
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

function safeJson(v: any): string {
	try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function escapeMd(s: string): string {
	return s.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, (m) => `\\${m}`);
}

