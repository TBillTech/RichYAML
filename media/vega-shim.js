// Classic script loader shim to avoid CORS on ESM in VS Code webviews
function loadScript(src, nonce) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    if (nonce) s.setAttribute('nonce', nonce);
    s.async = true;
    s.onload = () => resolve(src);
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.body.appendChild(s);
  });
}

async function loadWithFallback(urls, nonce, label) {
  let lastErr;
  for (const url of urls) {
    try {
      const loaded = await loadScript(url, nonce);
      console.log('[RichYAML] Loaded', label, 'from', loaded);
      return true;
    } catch (err) {
      console.warn('[RichYAML] Failed', label, 'from', url, err);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All sources failed for ' + label);
}

// Candidate UMD URLs (try several common paths). Prefer local vendor files if provided
const currentScript = document.currentScript;
const localVega = currentScript && currentScript.getAttribute('data-vega');
const localInterp = currentScript && currentScript.getAttribute('data-interpreter');
const noNetwork = currentScript && currentScript.getAttribute('data-no-network');
const VEGA_UMD = (noNetwork ? [localVega] : [
  localVega,
  'https://cdn.jsdelivr.net/npm/vega@6/build/vega.min.js',
  'https://cdn.jsdelivr.net/npm/vega@6/build/vega.js',
  'https://unpkg.com/vega@6/build/vega.min.js',
  'https://unpkg.com/vega@6/build/vega.js'
]).filter(Boolean);
const INTERP_UMD = (noNetwork ? [localInterp] : [
  localInterp,
  // Possible UMD locations for vega-interpreter v2
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/build/vega-interpreter.umd.js',
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/build/vega-interpreter.umd.min.js',
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/dist/vega-interpreter.umd.js',
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/dist/vega-interpreter.umd.min.js',
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/build/vega-interpreter.min.js',
  'https://cdn.jsdelivr.net/npm/vega-interpreter@2/build/vega-interpreter.js',
  'https://unpkg.com/vega-interpreter@2/build/vega-interpreter.umd.js',
  'https://unpkg.com/vega-interpreter@2/build/vega-interpreter.umd.min.js',
  'https://unpkg.com/vega-interpreter@2/dist/vega-interpreter.umd.js',
  'https://unpkg.com/vega-interpreter@2/dist/vega-interpreter.umd.min.js',
  'https://unpkg.com/vega-interpreter@2/build/vega-interpreter.min.js',
  'https://unpkg.com/vega-interpreter@2/build/vega-interpreter.js'
]).filter(Boolean);

(async function init() {
  try {
    // Try to read nonce from our own script tag, if present
  const nonce = currentScript && currentScript.nonce ? currentScript.nonce : undefined;
    await loadWithFallback(VEGA_UMD, nonce, 'Vega');
    if (!window.vega) throw new Error('Vega loaded but window.vega missing');

    await loadWithFallback(INTERP_UMD, nonce, 'vega-interpreter');
    // Bind any discovered interpreter to a stable global without mutating module objects
    const cand = (window.vega && window.vega.expressionInterpreter)
      || window.expressionInterpreter
      || (window.vegaInterpreter && window.vegaInterpreter.expressionInterpreter)
      || (window.vega && (window.vega.interpreter || window.vega.expr || window.vega.exprInterpreter));
    if (cand) {
      window.__vegaExpressionInterpreter = cand;
    }
    window.dispatchEvent(new Event('vega-ready'));
    console.log('[RichYAML] vega-shim: ready');
  } catch (err) {
    console.error('[RichYAML] vega-shim failed:', err);
    window.dispatchEvent(new CustomEvent('vega-ready', { detail: { error: err } }));
  }
})();
