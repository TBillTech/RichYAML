#!/usr/bin/env node
// Simple MathJax (mathjax-full) LaTeX -> SVG check.
// Usage: node scripts/test-mathjax.js "\\frac{a}{b} = c"

(async () => {
  try {
    const latex = process.argv[2] || String.raw`E=mc^2`;
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

    const node = html.convert(latex, { display: true });
    const svgText = adaptor.outerHTML(node);

    const fs = await import('fs');
    const path = await import('path');
    const outDir = path.resolve(__dirname, '..', 'tmp');
    const outFile = path.join(outDir, 'mathjax-test.svg');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, svgText, 'utf8');

    console.log('Wrote:', outFile);
    console.log('First 200 chars:\n', svgText.slice(0, 200).replace(/\n/g, ' '));
  } catch (e) {
    console.error('MathJax test failed:', e);
    process.exit(1);
  }
})();
