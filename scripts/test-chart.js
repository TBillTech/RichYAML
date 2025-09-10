// Quick sanity test for Vega toSVG in this environment
(async () => {
  try {
    let vega;
    try { vega = require('vega'); } catch { vega = (await import('vega')).default || (await import('vega')); }
    const values = [
      { t: '2025-01', d_au: 0.78 },
      { t: '2025-03', d_au: 1.2 },
      { t: '2025-05', d_au: 1.65 },
      { t: '2025-07', d_au: 1.0 }
    ];
    const spec = {
      $schema: 'https://vega.github.io/schema/vega/v5.json',
      width: 400,
      height: 200,
      padding: 5,
      data: [{ name: 'table', values }],
      scales: [
        { name: 'x', type: 'point', domain: { data: 'table', field: 't' }, range: 'width' },
        { name: 'y', type: 'linear', domain: { data: 'table', field: 'd_au' }, range: 'height' }
      ],
      axes: [ { orient: 'bottom', scale: 'x' }, { orient: 'left', scale: 'y' } ],
      marks: [ {
        type: 'line',
        from: { data: 'table' },
        encode: {
          enter: {
            x: { scale: 'x', field: 't' },
            y: { scale: 'y', field: 'd_au' },
            stroke: { value: '#4e79a7' },
            strokeWidth: { value: 2 }
          }
        }
      } ]
    };
    const view = new vega.View(vega.parse(spec), { renderer: 'none' });
    const svg = await view.toSVG();
    console.log('OK SVG length:', svg.length);
  } catch (e) {
    console.error('FAIL:', e && e.stack || e);
    process.exit(1);
  }
})();
