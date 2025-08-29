// Bundles Vega and vega-interpreter into IIFE globals for CSP-safe webview use.
// Outputs: media/vendor/vega.min.js and media/vendor/vega-interpreter.min.js
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true }).catch(() => {});
}

async function bundleAll() {
  const outDir = path.join(__dirname, '..', 'media', 'vendor');
  await ensureDir(outDir);

  // Bundle Vega into an IIFE global named 'vega'
  await esbuild.build({
    entryPoints: ['vega'],
    bundle: true,
    platform: 'browser',
    mainFields: ['browser', 'module', 'main'],
    format: 'iife',
    globalName: 'vega',
    minify: true,
    outfile: path.join(outDir, 'vega.min.js'),
    sourcemap: false,
    logLevel: 'info'
  });

  // Bundle vega-interpreter into an IIFE global named 'vegaInterpreter'
  await esbuild.build({
    entryPoints: ['vega-interpreter'],
    bundle: true,
    platform: 'browser',
    mainFields: ['browser', 'module', 'main'],
    format: 'iife',
    globalName: 'vegaInterpreter',
    minify: true,
    outfile: path.join(outDir, 'vega-interpreter.min.js'),
    sourcemap: false,
    logLevel: 'info'
  });

  console.log('[bundle-vega] Bundled Vega and vega-interpreter to media/vendor');
}

bundleAll().catch((err) => {
  console.error('[bundle-vega] Failed:', err);
  process.exit(1);
});
