import { parseDocument, isMap, isScalar, isSeq, Scalar, YAMLMap, YAMLSeq, Document } from 'yaml';

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
