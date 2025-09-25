// Task 19.B: Replace stubbed latexToMathJSON with real MathLive Compute Engine parsing.
// Implementation notes:
// - We attempt to load the Compute Engine from the installed 'mathlive' (which bundles it)
//   or '@cortex-js/compute-engine' dependency. The extension already ships mathlive in webviews,
//   but host-side parsing requires a Node import (tree-shaken by esbuild).
// - If parsing fails or CE unavailable, we fall back to the previous heuristic stub so that
//   mathjson is always present (never throw); downstream code can detect source !== 'compute-engine'.
// - We keep the exported shape compatible (now generalized) so existing validation continues.

export interface ParsedMathJSON {
  source: 'compute-engine' | 'stub';
  /** Original LaTeX text provided by user */
  latex: string;
  /** MathJSON expression (canonical when from compute-engine, heuristic when stub) */
  mathjson: any;
  /** Optional diagnostic message on fallback */
  diagnostics?: string;
}

// Attempt a synchronous load of the compute engine so first edit can parse properly.
let ceInstance: any | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ceMod = require('@cortex-js/compute-engine');
  if (ceMod?.ComputeEngine) ceInstance = new ceMod.ComputeEngine();
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ml = require('mathlive');
    if (ml?.ComputeEngine) ceInstance = new ml.ComputeEngine();
  } catch { /* ignore */ }
}

let cePromise: Promise<any> | null = null; // lazy async init if sync failed
async function loadComputeEngine(): Promise<any | null> {
  if (ceInstance) return ceInstance;
  if (!cePromise) {
    cePromise = (async () => {
      try {
        const mod = await import('@cortex-js/compute-engine');
        if ((mod as any)?.ComputeEngine) return (ceInstance = new (mod as any).ComputeEngine());
      } catch {}
      try {
        const ml = await import('mathlive');
        if ((ml as any)?.ComputeEngine) return (ceInstance = new (ml as any).ComputeEngine());
      } catch {}
      return null;
    })();
  }
  return cePromise;
}

// Heuristic fallback kept from original stub for resilience.
function heuristicStub(latex: string): ParsedMathJSON {
  const raw = latex.trim();
  if (!raw) return { source: 'stub', latex: '', mathjson: ["Expr"], diagnostics: 'empty input' };
  // Quick equality detection without requiring spaces; ignore escaped '=' (rare)
  const eqPos = (() => {
    let depth = 0; // brace depth to avoid splitting inside {...}
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === '=' && depth === 0) return i;
    }
    return -1;
  })();
  if (eqPos > 0 && eqPos < raw.length - 1) {
    const lhs = raw.slice(0, eqPos);
    const rhs = raw.slice(eqPos + 1);
    return { source: 'stub', latex: raw, mathjson: ["Equal", lhs, rhs], diagnostics: 'stub equality heuristic' };
  }
  return { source: 'stub', latex: raw, mathjson: ["Expr", raw], diagnostics: 'stub opaque' };
}

// Public API used by applyEdits.ts (host side). Synchronous wrapper returning stub immediately
// and upgrading in background would complicate editing; instead we block briefly (CE load should
// be fast after first import). If CE not available, user gets stub quickly.
export async function latexToMathJSONAsync(latex: string | undefined | null, overrides?: string[] | undefined): Promise<ParsedMathJSON> {
  const input = (latex ?? '').trim();
  if (!input) return heuristicStub(input);
  const ce = await loadComputeEngine();
  if (ce) {
    try {
      if (Array.isArray(overrides) && overrides.length) {
        const scope: Record<string, any> = {};
        for (const sym of overrides) scope[sym] = { kind: 'symbol' };
        try { ce.pushScope(scope); } catch {}
      }
      const expr = ce.parse(input, { canonical: false });
      let json = expr?.json ?? null;
      if (json) {
        if (overrides && overrides.length) json = applyConstantOverrides(json, overrides);
        return { source: 'compute-engine', latex: input, mathjson: json };
      }
    } catch (e: any) {
      return { ...heuristicStub(input), diagnostics: 'parse error: ' + (e?.message || String(e)) };
    }
  }
  return heuristicStub(input);
}

// Backwards-compatible synchronous facade used in existing edit pipeline. It attempts a cached CE
// instance synchronously (best-effort). If CE promise resolved earlier, we reuse it synchronously.
// Otherwise returns stub to keep UI responsive.
export function latexToMathJSON(latex: string | undefined | null, overrides?: string[] | undefined): any {
  const input = (latex ?? '').trim();
  if (!input) return ["Expr"]; // minimal empty
  if (ceInstance) {
    try {
      if (Array.isArray(overrides) && overrides.length) {
        const scope: Record<string, any> = {};
        for (const sym of overrides) scope[sym] = { kind: 'symbol' };
        try { ceInstance.pushScope(scope); } catch {}
      }
      const expr = ceInstance.parse(input, { canonical: false });
      let json = expr?.json ?? null;
      if (json) {
        if (overrides && overrides.length) json = applyConstantOverrides(json, overrides);
        return json;
      }
    } catch { /* ignore */ }
  }
  return heuristicStub(input).mathjson;
}

// Pre-warm compute engine after short delay to reduce first-edit latency.
setTimeout(() => { void loadComputeEngine(); }, 50);

// Map override symbol -> list of constant node names produced by CE to replace
const CONSTANT_NAME_MAP: Record<string, string[]> = {
  G: ['CatalanConstant'],
  // Extend here if needed (e.g., E: ['ExponentialE']) once we confirm use cases
};

function applyConstantOverrides(json: any, overrides: string[]): any {
  if (!json) return json;
  const targetSets: Array<[string, Set<string>]> = [];
  const overrideSet = new Set(overrides);
  for (const sym of overrideSet) {
    const constNames = CONSTANT_NAME_MAP[sym];
    if (constNames && constNames.length) targetSets.push([sym, new Set(constNames)]);
  }
  if (!targetSets.length) return json; // nothing to replace

  const visit = (node: any): any => {
    if (Array.isArray(node)) {
      if (node.length === 1 && typeof node[0] === 'string') {
        // Bare constant wrapped oddly (unlikely) – fall through
      }
      // Transform children
      const head = node[0];
      // Replace bare constant name if matches
      if (typeof head === 'string') {
        for (const [sym, nameSet] of targetSets) {
          if (nameSet.has(head)) {
            // Replace whole node with symbol (unless structure demands retention)
            if (node.length === 1) return sym;
            // If it's an At(CatalanConstant, sub) pattern, rewrite first element only
            if (head === 'At' && node.length >= 3) {
              // This case handled below as normal recursion
            }
          }
        }
      }
      // Deep map
      const mapped = node.map(ch => visit(ch));
      // Special case: At(ConstantName, subscript) -> At(Symbol, subscript)
      if (mapped[0] === 'At' && mapped.length === 3) {
        for (const [sym, nameSet] of targetSets) {
          const target = mapped[1];
          if (typeof target === 'string' && nameSet.has(target)) {
            const clone = [...mapped];
            clone[1] = sym;
            return clone;
          }
        }
      }
      // Replace node that started with constant entirely (CatalanConstant -> G)
      if (typeof mapped[0] === 'string') {
        for (const [sym, nameSet] of targetSets) {
          if (nameSet.has(mapped[0] as string) && mapped.length === 1) return sym;
        }
      }
      return mapped;
    } else if (typeof node === 'string') {
      // Leaf string constant
      for (const [sym, nameSet] of targetSets) {
        if (nameSet.has(node)) return sym;
      }
      return node;
    } else if (typeof node === 'object' && node) {
      // Possibly object form (rare in this workflow). Map values.
      const out: any = Array.isArray(node) ? [] : {};
      for (const k of Object.keys(node)) out[k] = visit((node as any)[k]);
      return out;
    }
    return node;
  };
  try { return visit(json); } catch { return json; }
}
