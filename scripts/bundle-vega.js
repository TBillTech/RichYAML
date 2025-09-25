// Bundles Vega and vega-interpreter into IIFE globals and copies MathLive assets.
// Outputs:
//  - media/vendor/vega.min.js
//  - media/vendor/vega-interpreter.min.js
//  - media/vendor/mathlive.min.js
//  - media/vendor/mathlive-static.css
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

  // Copy MathLive assets (JS + CSS) from node_modules to vendor
  try {
    const nm = path.join(__dirname, '..', 'node_modules', 'mathlive');
    const outDir = path.join(__dirname, '..', 'media', 'vendor');
    const srcJs = path.join(nm, 'mathlive.min.js');
    const srcCss = path.join(nm, 'mathlive-static.css');
    const srcFontsCss = path.join(nm, 'mathlive-fonts.css');
    const dstJs = path.join(outDir, 'mathlive.min.js');
    const dstCss = path.join(outDir, 'mathlive-static.css');
    const dstFontsCss = path.join(outDir, 'mathlive-fonts.css');
    await fs.promises.copyFile(srcJs, dstJs);
    await fs.promises.copyFile(srcCss, dstCss);
    // fonts CSS and font files
    await fs.promises.copyFile(srcFontsCss, dstFontsCss).catch(() => {});
    const srcFontsDir = path.join(nm, 'fonts');
    const dstFontsDir = path.join(outDir, 'fonts');
    await ensureDir(dstFontsDir);
    try {
      const fontFiles = await fs.promises.readdir(srcFontsDir);
      for (const f of fontFiles) {
        await fs.promises.copyFile(path.join(srcFontsDir, f), path.join(dstFontsDir, f));
      }
    } catch {}
    console.log('[bundle-vega] Copied MathLive assets to media/vendor');
  } catch (err) {
    console.warn('[bundle-vega] MathLive not found; skipping copy', err?.message || err);
  }

  // Bundle Compute Engine (from @cortex-js/compute-engine) into IIFE global 'ComputeEngine'
  try {
    await esbuild.build({
      entryPoints: ['@cortex-js/compute-engine'],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'ComputeEngine',
      minify: true,
      outfile: path.join(outDir, 'compute-engine.min.js'),
      sourcemap: false,
      logLevel: 'info'
    });
    console.log('[bundle-vega] Bundled Compute Engine to media/vendor');
  } catch (err) {
    console.warn('[bundle-vega] Compute Engine bundle failed', err?.message || err);
  }
}

bundleAll().catch((err) => {
  console.error('[bundle-vega] Failed:', err);
  process.exit(1);
});
