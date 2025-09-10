import * as vscode from 'vscode';
import { parseWithTags, findRichNodes, RichNodeInfo } from './yamlService';
import { resolveDataFileRelative } from './dataResolver';
import { getChartCache } from './chartCache';

export function registerChartPreRenderer(context: vscode.ExtensionContext) {
  const timers = new Map<string, NodeJS.Timeout>();
  let disposed = false;

  const schedule = (doc: vscode.TextDocument) => {
    if (disposed) return;
    if (!isRichYamlDoc(doc)) return;
    const key = doc.uri.toString();
    const delay = Math.max(0, Number(vscode.workspace.getConfiguration('richyaml').get('preview.inline.debounceMs', 150)) || 0);
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);
    timers.set(key, setTimeout(() => {
      if (disposed) return;
      timers.delete(key);
      preRender(doc).catch(() => {});
    }, Math.max(100, Math.min(500, delay))));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
  { dispose: () => { disposed = true; try { for (const t of timers.values()) clearTimeout(t); } catch {} timers.clear(); } }
  );
}

async function preRender(doc: vscode.TextDocument) {
  try {
    const text = doc.getText();
    const nodes = findRichNodes(text);
    const parsed = parseWithTags(text);
    if (!parsed.ok) return;
    const cfg = vscode.workspace.getConfiguration('richyaml');
    const maxPts = Math.max(0, Number(cfg.get('preview.inline.maxDataPoints', 1000)) || 0);
    const cache = getChartCache();
    for (const n of nodes) {
      if (n.tag !== '!chart') continue;
      const payload = getNodePayload(parsed.tree as any, n);
      if (!payload) continue;
      // Build spec & values just like hover
      const { spec, values, width, height } = await buildSpecAndValues(payload, doc.uri, maxPts);
      await cache.getOrRender(doc.uri.toString(), doc.version, n.path, spec, values, width, height);
    }
  } catch {
    // Silent pre-render failures; hover still attempts rendering lazily
  }
}

function isRichYamlDoc(doc: vscode.TextDocument): boolean {
  const name = doc.uri.fsPath.toLowerCase();
  const isYamlLike = doc.languageId === 'yaml' || doc.languageId === 'richyaml';
  if (!isYamlLike) return false;
  if (name.endsWith('.r.yaml') || name.endsWith('.r.yml')) return true;
  const sample = doc.getText(new vscode.Range(0, 0, Math.min(2000, doc.lineCount), 0));
  return /!(equation|chart)\b/.test(sample);
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
  if (tag !== '!chart') return undefined;
  const { title, mark, data, encoding, legend, colors, vegaLite, width, height } = cur as any;
  return { title, mark, data, encoding, legend, colors, vegaLite, width, height };
}

async function buildSpecAndValues(payload: any, docUri: vscode.Uri, maxPts: number): Promise<{ spec: any; values?: any[]; width?: number; height?: number }> {
  const spec: any = {};
  const vegaLite = (payload as any)?.vegaLite;
  if (vegaLite && typeof vegaLite === 'object') {
    Object.assign(spec, vegaLite);
  } else {
    const mark = (payload as any)?.mark ?? 'line';
    spec.mark = mark;
    spec.encoding = (payload as any)?.encoding ?? {};
  }
  let values: any[] | undefined;
  const data = (payload as any)?.data;
  if (data?.values && Array.isArray(data.values)) {
    values = data.values.slice(0, maxPts);
  } else if (typeof data?.file === 'string' && data.file) {
    try { values = await resolveDataFileRelative(docUri, data.file, maxPts); } catch {}
  }
  // Coerce common types
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
  const width = Number((payload as any)?.width) || undefined;
  const height = Number((payload as any)?.height) || undefined;
  return { spec, values, width, height };
}
