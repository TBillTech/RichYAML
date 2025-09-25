// Task 19: Lightweight LaTeX -> MathJSON adapter stub.
// This is a placeholder until a real MathLive Compute Engine or MathJSON parser
// is bundled. It performs a tiny heuristic parse so that editing LaTeX updates
// a canonical-ish mathjson structure for downstream tools (e.g., Maxima, CAS).
// Policy: never throw; always return an object so schema `mathjson` requirement
// is satisfied. Downstream can detect `source: 'stub'` to decide whether to
// re-parse with a stronger engine.

export interface MathJSONStub {
  source: 'stub';
  /** Original LaTeX text provided by user */
  latex: string;
  /** Heuristic functional form */
  fn: any[]; // e.g., ["Equal", lhs, rhs] or ["Expr", ...tokens]
  /** Flat token list (raw) for debugging */
  tokens: string[];
}

const WS_RE = /\s+/g;

export function latexToMathJSON(latex: string | undefined | null): MathJSONStub {
  const raw = (latex ?? '').trim();
  if (!raw) {
    return { source: 'stub', latex: '', fn: ["Expr"], tokens: [] };
  }
  // Strip surrounding math mode markers if present: $...$, $$...$$, \[...\]
  let txt = raw;
  if ((txt.startsWith('$$') && txt.endsWith('$$')) || (txt.startsWith('\\[') && txt.endsWith('\\]'))) {
    txt = txt.replace(/^\$\$|^\\\[|\$\$$/g, '').replace(/\\\]$/g, '');
  } else if (txt.startsWith('$') && txt.endsWith('$')) {
    txt = txt.slice(1, -1);
  }
  // Tokenize by spaces and basic LaTeX command boundaries (very naive)
  const tokens = txt
    .replace(WS_RE, ' ')
    .split(' ')
    .map(t => t)
    .filter(t => t.length);

  // Detect simple equality pattern A = B (single '=' token)
  const eqIdx = tokens.indexOf('=');
  if (eqIdx > 0 && eqIdx < tokens.length - 1) {
    const lhs = tokens.slice(0, eqIdx).join(' ');
    const rhs = tokens.slice(eqIdx + 1).join(' ');
    return { source: 'stub', latex: raw, fn: ["Equal", lhs, rhs], tokens };
  }

  return { source: 'stub', latex: raw, fn: ["Expr", ...tokens], tokens };
}
