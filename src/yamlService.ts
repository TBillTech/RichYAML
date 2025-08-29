import { parseDocument, isMap, isScalar, isSeq, Scalar, YAMLMap, YAMLSeq, Document } from 'yaml';

export type RichNodeInfo = {
  tag: string;
  /** JSONPath-like segments to the node (keys or numeric indices) */
  path: Array<string | number>;
  /** Start and end offsets in the original text */
  range: { start: number; end: number };
  /** Node kind for debugging */
  kind: 'map' | 'seq' | 'scalar' | 'unknown';
};

export type ParsedResult =
  | { ok: true; doc: Document.Parsed; tree: unknown }
  | { ok: false; error: string };

/**
 * Parse YAML text into a Document while preserving comments and tags.
 * Also produce a plain JS tree that includes `$tag` hints for custom-tagged nodes.
 */
export function parseWithTags(text: string): ParsedResult {
  try {
    const doc = parseDocument(text, { keepSourceTokens: true });
    if (doc.errors && doc.errors.length) {
      return { ok: false, error: doc.errors.map((e: any) => e.message).join('; ') };
    }
    const root: any = doc.contents as any;
    const tree = toPlainWithTags(root);
    return { ok: true, doc, tree };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Serialize a YAML.Document back to text, preserving comments when possible. */
export function serialize(doc: Document.Parsed): string {
  return doc.toString();
}

/**
 * Recursively convert YAML nodes to plain JS while attaching `$tag` to nodes
 * that use a non-default tag (e.g., `!equation`, `!chart`).
 */
function toPlainWithTags(node: any): unknown {
  if (node == null) return null;
  // Scalar
  if (isScalar(node)) {
    const value = (node as Scalar).toJSON?.() ?? (node as Scalar).value;
    const tag = (node as any).tag as string | undefined;
    if (tag && tag.startsWith('!')) return { $tag: tag, $value: value };
    return value;
  }
  // Map
  if (isMap(node)) {
    const mapNode = node as YAMLMap<unknown, unknown>;
    const obj: Record<string, unknown> = {};
    for (const item of mapNode.items) {
      const kNode: any = item.key as any;
      const key = typeof kNode?.value === 'string' ? kNode.value : String(kNode?.toString?.() ?? kNode?.value);
      obj[key] = toPlainWithTags(item.value as any);
    }
    const tag = (node as any).tag as string | undefined;
    if (tag && tag.startsWith('!')) return { $tag: tag, ...obj };
    return obj;
  }
  // Seq
  if (isSeq(node)) {
    const seqNode = node as YAMLSeq<unknown>;
    const arr = seqNode.items.map((it: any) => toPlainWithTags(it));
    const tag = (node as any).tag as string | undefined;
    if (tag && tag.startsWith('!')) return { $tag: tag, $items: arr };
    return arr;
  }
  // Fallback
  const anyNode: any = node;
  const value = anyNode.toJSON ? anyNode.toJSON() : anyNode;
  const tag = (node as any).tag as string | undefined;
  if (tag && tag.startsWith('!')) return { $tag: tag, $value: value };
  return value;
}

/**
 * Find all RichYAML-tagged nodes (!equation, !chart) and return their text ranges.
 * Uses CST range when available for best accuracy, falling back to AST range.
 */
export function findRichNodes(text: string): RichNodeInfo[] {
  const results: RichNodeInfo[] = [];
  let doc: any;
  try {
    doc = parseDocument(text, { keepSourceTokens: true }) as any;
  } catch {
    return regexFallback(text);
  }
  if (doc?.errors?.length) return regexFallback(text);

  const visit = (node: any, path: Array<string | number>) => {
    if (!node) return;
    const tag: string | undefined = node.tag;
    const kind: RichNodeInfo['kind'] = isMap(node) ? 'map' : isSeq(node) ? 'seq' : isScalar(node) ? 'scalar' : 'unknown';

    if (tag && (tag === '!equation' || tag === '!chart')) {
      const { start, end } = nodeTextRange(node);
      if (start != null && end != null) {
        results.push({ tag, path: [...path], range: { start, end }, kind });
      }
    }

    if (isMap(node)) {
      for (const item of (node as YAMLMap<unknown, unknown>).items) {
        const keyNode: any = item.key as any;
        const key = typeof keyNode?.value === 'string' ? keyNode.value : String(keyNode?.toString?.() ?? keyNode?.value);
        visit(item.value as any, path.concat(key));
      }
    } else if (isSeq(node)) {
      (node as YAMLSeq<unknown>).items.forEach((child: any, idx: number) => visit(child, path.concat(idx)));
    }
  };

  const root = (doc as any).contents;
  visit(root, []);
  return results;

  function regexFallback(src: string): RichNodeInfo[] {
    // Heuristic: scan lines for tags; anchor decoration markers even if YAML is invalid
    const out: RichNodeInfo[] = [];
    const tagRe = /!(equation|chart)\b/;
    let offset = 0;
    const lines = src.split(/\r?\n/);
    for (const line of lines) {
      const m = tagRe.exec(line);
      if (m) {
        const start = offset + m.index;
        const end = start + line.length - m.index; // approximate to line end
        const tag = m[0].toLowerCase() as '!equation' | '!chart';
        out.push({ tag, path: [], range: { start, end }, kind: 'unknown' });
      }
      offset += line.length + 1; // account for split removing newline
    }
    return out;
  }

  function nodeTextRange(n: any): { start: number; end: number } {
    // Prefer CST node range for precise start at the tag line
    const cst = n?.cstNode as any;
    if (cst && cst.range && typeof cst.range.start === 'number' && typeof cst.range.end === 'number') {
      return { start: cst.range.start, end: cst.range.end };
    }
    // Fallback to AST range shapes (array or object)
    const r: any = n?.range;
    if (Array.isArray(r) && r.length >= 2) return { start: r[0] as number, end: r[1] as number };
    if (r && typeof r.start === 'number' && typeof r.end === 'number') return { start: r.start, end: r.end };
    // Worst-case: approximate by finding the first non-space character at/after key line
    return { start: 0, end: 0 };
  }
}

/** Find the YAML AST node at a given JSONPath-like path. */
export function getYamlNodeAtPath(doc: Document.Parsed, path: Array<string | number>): any | undefined {
  let cur: any = (doc as any).contents;
  for (const seg of path) {
    if (cur == null) return undefined;
    if (isMap(cur)) {
      const map = cur as YAMLMap<unknown, unknown>;
      let found: any = undefined;
      for (const item of map.items) {
        const kNode: any = item.key as any;
        const key = typeof kNode?.value === 'string' ? kNode.value : String(kNode?.toString?.() ?? kNode?.value);
        if (key === seg) { found = item.value; break; }
      }
      cur = found;
    } else if (isSeq(cur) && typeof seg === 'number') {
      const seq = cur as YAMLSeq<unknown>;
      cur = seq.items[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Find the text range of a property value within a Map at the given path.
 * Returns start/end offsets of the VALUE node. If the property is absent, returns undefined.
 */
export function getPropertyValueRange(
  text: string,
  path: Array<string | number>,
  prop: string
): { start: number; end: number } | undefined {
  let doc: Document.Parsed;
  try {
    doc = parseDocument(text, { keepSourceTokens: true }) as any;
  } catch {
    return undefined;
  }
  const node = getYamlNodeAtPath(doc, path);
  if (!node || !isMap(node)) return undefined;
  const map = node as YAMLMap<unknown, unknown>;
  for (const item of map.items) {
    const kNode: any = item.key as any;
    const key = typeof kNode?.value === 'string' ? kNode.value : String(kNode?.toString?.() ?? kNode?.value);
    if (key === prop) {
      const v: any = item.value as any;
      const cst = v?.cstNode as any;
      if (cst?.range && typeof cst.range.start === 'number' && typeof cst.range.end === 'number') {
        return { start: cst.range.start, end: cst.range.end };
      }
      const r: any = v?.range;
      if (Array.isArray(r) && r.length >= 2) return { start: r[0] as number, end: r[1] as number };
      if (r && typeof r.start === 'number' && typeof r.end === 'number') return { start: r.start, end: r.end };
      return undefined;
    }
  }
  return undefined;
}

