// For hovers, render charts headlessly using Vega.
// Use true dynamic import to support ESM with top-level await from a CJS extension host.
let vegaMod: any | null = null;
async function getVega() {
  if (vegaMod) return vegaMod;
  const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  try {
    const mod = await dynImport('vega/build/vega.node.js');
    vegaMod = (mod && mod.default) ? mod.default : mod;
    try { console.log('[RichYAML] Vega loader:', 'vega/build/vega.node.js'); } catch {}
  } catch {
    try {
      const mod = await dynImport('vega/build/vega.js');
      vegaMod = (mod && mod.default) ? mod.default : mod;
      try { console.log('[RichYAML] Vega loader:', 'vega/build/vega.js'); } catch {}
    } catch {
      const mod = await dynImport('vega');
      vegaMod = (mod && mod.default) ? mod.default : mod;
      try { console.log('[RichYAML] Vega loader:', 'vega (package export)'); } catch {}
    }
  }
  return vegaMod;
}

export type VegaLikeSpec = any;

export async function renderChartToSvgDataUri(spec: VegaLikeSpec, values?: any[], width?: number, height?: number): Promise<string | undefined> {
  try {
  const vega = await getVega();
  const specCopy: any = { ...spec };
    if (values && specCopy?.data) {
      if (Array.isArray(specCopy.data)) {
        // First named dataset gets the values
        if (specCopy.data.length && !specCopy.data[0].values) specCopy.data[0].values = values;
      } else {
        if (!specCopy.data.values) specCopy.data.values = values;
      }
    }
    if (width) specCopy.width = width;
    if (height) specCopy.height = height;

    // Determine if spec is Vega-Lite-like (mark/encoding) or already Vega.
    let vegaSpec: any = specCopy;
    const isLite = !!(specCopy && (specCopy.mark || specCopy.encoding));
    if (isLite) {
      vegaSpec = compileLiteLikeToVega(specCopy, Array.isArray(values) ? values : []);
    }

    const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' });
    const svgText = await view.toSVG();
    const b64 = Buffer.from(svgText, 'utf8').toString('base64');
    return 'data:image/svg+xml;base64,' + b64;
  } catch (e: any) {
    console.error('[RichYAML] chart render error:', e);
    // Re-throw so callers (hover/cache) can display the cause
    throw new Error(e?.message || String(e));
  }
}

function compileLiteLikeToVega(lite: any, values: any[]): any {
  const x = lite?.encoding?.x || {};
  const y = lite?.encoding?.y || {};
  const xf = String(x.field || 'x');
  const yf = String(y.field || 'y');
  const xt = String(x.type || 'quantitative').toLowerCase();
  const yt = String(y.type || 'quantitative').toLowerCase();
  const mark = (lite?.mark || 'line').toString().toLowerCase();
  const xScale = scaleForType(xt, 'x', mark);
  const yScale = scaleForType(yt, 'y', mark);

  const spec = {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    width: lite.width || 400,
    height: lite.height || 200,
    padding: 5,
    data: [ { name: 'table', values } ],
    scales: [
      { name: 'x', type: xScale.type, domain: { data: 'table', field: xf }, range: 'width' },
      { name: 'y', type: yScale.type, domain: { data: 'table', field: yf }, range: 'height' }
    ],
    axes: [
      { orient: 'bottom', scale: 'x' },
      { orient: 'left', scale: 'y' }
    ],
    marks: [
      buildMark(mark, xf, yf)
    ]
  } as any;
  return spec;
}

function scaleForType(t: string, axis: 'x'|'y', mark: string): { type: string } {
  switch (t) {
    case 'temporal': return { type: 'utc' };
  case 'nominal': return { type: (mark === 'bar') ? 'band' : 'point' };
  case 'ordinal': return { type: (mark === 'bar') ? 'band' : 'point' };
    default: return { type: 'linear' };
  }
}

function buildMark(mark: string, xf: string, yf: string): any {
  if (mark === 'bar') {
    return {
      type: 'rect',
      from: { data: 'table' },
      encode: {
        enter: {
          x: { scale: 'x', field: xf },
          width: { scale: 'x', band: 1 },
          y: { scale: 'y', field: yf },
          y2: { scale: 'y', value: 0 },
          fill: { value: '#4e79a7' }
        }
      }
    };
  }
  if (mark === 'point' || mark === 'circle') {
    return {
      type: 'symbol',
      from: { data: 'table' },
      encode: {
        enter: {
          x: { scale: 'x', field: xf },
          y: { scale: 'y', field: yf },
          size: { value: 30 },
          fill: { value: '#59a14f' }
        }
      }
    };
  }
  // default line
  return {
    type: 'line',
    from: { data: 'table' },
    encode: {
      enter: {
        x: { scale: 'x', field: xf },
        y: { scale: 'y', field: yf },
        stroke: { value: '#4e79a7' },
        strokeWidth: { value: 2 }
      }
    }
  };
}
