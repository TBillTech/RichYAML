import * as vscode from 'vscode';

// Lazy-load MathJax only if needed to keep activation light
let mjInit: Promise<Renderer> | null = null;

type Renderer = {
  toSvgDataUri: (latex: string, display: boolean) => string;
};

export async function renderLatexToSvgDataUri(latex: string, display: boolean = true): Promise<string | undefined> {
  try {
    if (!mjInit) mjInit = initMathJax();
    const r = await mjInit;
    return r.toSvgDataUri(latex, display);
  } catch (e) {
    console.error('[RichYAML] hover render error:', e);
    return undefined;
  }
}

export async function renderLatexToSvgMarkup(latex: string, display: boolean = true): Promise<string | undefined> {
  try {
    if (!mjInit) mjInit = initMathJax();
    const r = await mjInit;
    // Decode the data URI produced by MathJax back into SVG markup
    const data = r.toSvgDataUri(latex, display);
    if (!data || !data.startsWith('data:image/svg+xml')) return undefined;
    const comma = data.indexOf(',');
    if (comma < 0) return undefined;
    const meta = data.substring(0, comma);
    const payload = data.substring(comma + 1);
    let svg: string;
    if (/;base64/i.test(meta)) {
      svg = Buffer.from(payload, 'base64').toString('utf8');
    } else {
      // Fallback for non-base64 data URIs (percent-encoded)
      svg = decodeURIComponent(payload);
    }
    // MathJax wraps SVG in <mjx-container> by default; extract pure <svg> for better embedding
    try {
      const i0 = svg.indexOf('<svg');
      const i1 = svg.indexOf('</svg>');
      if (i0 >= 0 && i1 > i0) svg = svg.slice(i0, i1 + '</svg>'.length);
    } catch {}
    return svg || undefined;
  } catch (e) {
    console.error('[RichYAML] hover render (markup) error:', e);
    return undefined;
  }
}

// Simple in-memory cache (latex+display) → data URI
const cache = new Map<string, string>();

async function initMathJax(): Promise<Renderer> {
  // Defer requires to runtime
  const { mathjax } = await import('mathjax-full/js/mathjax.js');
  const { TeX } = await import('mathjax-full/js/input/tex.js');
  const { SVG } = await import('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: ['base', 'ams'] });
  const svg = new SVG({ fontCache: 'none' });
  const html = mathjax.document('', { InputJax: tex, OutputJax: svg });

  const toSvgDataUri = (latex: string, display: boolean) => {
    const key = `${display ? 'D' : 'I'}:${latex}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const node = html.convert(latex, { display });
    let svgText = adaptor.outerHTML(node as any);
    // Extract the pure <svg>…</svg> markup from MathJax wrapper
    try {
      const i0 = svgText.indexOf('<svg');
      const i1 = svgText.indexOf('</svg>');
      if (i0 >= 0 && i1 > i0) svgText = svgText.slice(i0, i1 + '</svg>'.length);
    } catch {}
    // Use base64 to avoid issues with special chars in data URIs
    const b64 = Buffer.from(svgText, 'utf8').toString('base64');
    const uri = 'data:image/svg+xml;base64,' + b64;
    cache.set(key, uri);
    // Cap cache size
    if (cache.size > 200) {
      const it = cache.keys().next();
      if (!it.done && it.value) cache.delete(it.value);
    }
    return uri;
  };

  return { toSvgDataUri };
}
