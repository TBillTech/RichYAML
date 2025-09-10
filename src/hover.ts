import * as vscode from 'vscode';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';
import { renderLatexToSvgDataUri, renderLatexToSvgMarkup } from './hoverRender';
import * as crypto from 'crypto';
import * as path from 'path';
import { renderChartToSvgDataUri } from './chartRender';
import { getChartCache } from './chartCache';
import { resolveDataFileRelative } from './dataResolver';

/** Register rich hovers for YAML and RichYAML files. */
export function registerRichYAMLHover(context: vscode.ExtensionContext) {
	const selector: vscode.DocumentSelector = [
		{ language: 'yaml' },
		{ language: 'richyaml' }
	];

	// In-memory SVG content store + content provider so hovers can load images reliably
	const scheme = 'richyaml-hover';
	const svgStore = new Map<string, string>();
	const svgProvider: vscode.TextDocumentContentProvider = {
		onDidChange: undefined,
		provideTextDocumentContent(uri: vscode.Uri): string {
			// Path like "/<id>.svg"; key is id without extension
			const id = uri.path.replace(/^\/*/, '').replace(/\.svg$/i, '');
			const svg = svgStore.get(id) || '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
			return svg;
		}
	};
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, svgProvider));

	function uriForSvg(svg: string): vscode.Uri {
		const id = crypto.createHash('sha1').update(svg).digest('hex').slice(0, 24);
		if (!svgStore.has(id)) svgStore.set(id, svg);
		return vscode.Uri.parse(`${scheme}:/${id}.svg`);
	}

	const provider: vscode.HoverProvider = {
		async provideHover(document, position, token) {
			if (token?.isCancellationRequested) return undefined;

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

			if (token?.isCancellationRequested) return undefined;
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
				if (latex && latex.trim()) {
					// Try data URI first (reliable in hover)
					if (token?.isCancellationRequested) return undefined;
					const dataUri = await renderLatexToSvgDataUri(latex, true);
					if (dataUri) {
						md.appendMarkdown(`\n![](${dataUri})`);
					} else {
						// Fallback to provider URI using raw <svg>
						if (token?.isCancellationRequested) return undefined;
						const svg = await renderLatexToSvgMarkup(latex, true);
						if (svg) {
							let svgOnly = svg;
							const i0 = svgOnly.indexOf('<svg');
							const i1 = svgOnly.indexOf('</svg>');
							if (i0 >= 0 && i1 > i0) svgOnly = svgOnly.slice(i0, i1 + '</svg>'.length);
							const imgUri = uriForSvg(svgOnly);
							md.appendMarkdown(`\n![](${imgUri.toString(true)})`);
						} else {
							md.appendMarkdown('_Preview unavailable_');
						}
					}
				} else if ((payload as any)?.mathjson) {
					const json = safeJson((payload as any).mathjson);
					md.appendCodeblock(json, 'json');
				} else {
					md.appendMarkdown('_No equation details available_');
				}
			} else if (node.tag === '!chart') {
				const cfg = vscode.workspace.getConfiguration('richyaml');
				const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
				const title = (payload as any)?.title as string | undefined;
				if (title) md.appendMarkdown(`**${escapeMd(title)}**\n\n`);
				// Build a minimal Vega(-Lite-like) spec
				const spec: any = {};
				const vegaLite = (payload as any)?.vegaLite;
				if (vegaLite && typeof vegaLite === 'object') {
					Object.assign(spec, vegaLite);
				} else {
					// Synthesize a tiny spec from mark/encoding/data
					const mark = (payload as any)?.mark ?? 'line';
					spec.mark = mark;
					spec.encoding = (payload as any)?.encoding ?? {};
				}
				// Handle data
				let values: any[] | undefined;
				const data = (payload as any)?.data;
				if (data?.values && Array.isArray(data.values)) {
					values = data.values.slice(0, maxPts);
				} else if (typeof data?.file === 'string' && data.file) {
						try { if (!token?.isCancellationRequested) values = await resolveDataFileRelative(document.uri, data.file, maxPts); } catch {}
				}
				// Coerce value types if types are declared
				try {
					const enc: any = spec.encoding || {};
					const xf = enc.x?.field; const xt = String(enc.x?.type || '').toLowerCase();
					const yf = enc.y?.field; const yt = String(enc.y?.type || '').toLowerCase();
					if (Array.isArray(values)) {
						values = values.map((r) => {
							const o: any = { ...r };
							if (xf && (xt === 'quantitative') && o[xf] != null) o[xf] = Number(o[xf]);
							if (yf && (yt === 'quantitative') && o[yf] != null) o[yf] = Number(o[yf]);
							if (xf && (xt === 'temporal') && o[xf] != null) o[xf] = new Date(o[xf]).toISOString();
							if (yf && (yt === 'temporal') && o[yf] != null) o[yf] = new Date(o[yf]).toISOString();
							return o;
						});
					}
				} catch {}
				// Optional explicit size
				const width = Number((payload as any)?.width) || undefined;
				const height = Number((payload as any)?.height) || undefined;
				try {
					const cache = getChartCache();
					if (token?.isCancellationRequested) return undefined;
					const uri = await cache.getOrRender(document.uri.toString(), document.version, node.path, spec, values, width, height);
					if (uri) {
						md.appendMarkdown(`\n![](${uri})`);
					} else {
						md.appendMarkdown('_Preview unavailable (cache miss after render)_');
					}
				} catch (e: any) {
					const msg = (e?.message ? String(e.message) : String(e)).replace(/[`*_]|\n/g, ' ');
					md.appendMarkdown(`_Preview unavailable: ${escapeMd(msg)}_`);
				}
			} else {
				md.appendMarkdown('_Unsupported rich node_');
			}

			// Quick action link to open the mini editor for this node
			try {
				const args = [document.uri, node.path, node.tag];
				const cmdUri = vscode.Uri.parse(
					`command:richyaml.editNodeAtCursor?${encodeURIComponent(JSON.stringify(args))}`
				);
				// Allow a trusted command link
				md.isTrusted = true;
				md.appendMarkdown(`\n\n[Edit…](${cmdUri.toString()})`);
			} catch {}

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

