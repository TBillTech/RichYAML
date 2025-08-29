/* Inline inset renderer for a single RichYAML node (equation/chart) */
(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, String(v));
    }
    for (const ch of children) {
      if (ch == null) continue;
      if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    }
    return el;
  }

  function renderEquation(root, data) {
    root.innerHTML = '';
    const title = h('div', { className: 'ry-title', text: data.desc || 'Equation' });
    const body = h('div', { className: 'ry-body' });
    const mf = document.createElement('math-field');
    mf.setAttribute('readonly', '');
    mf.setAttribute('virtual-keyboard-mode', 'off');
    try { mf.value = data.latex ? String(data.latex) : '\\text{MathJSON}'; } catch {}
    body.appendChild(mf);
    if (!data.latex && data.mathjson) {
      const pre = h('pre', { className: 'ry-json' }, JSON.stringify(data.mathjson, null, 2));
      body.appendChild(pre);
    }
    root.appendChild(title);
    root.appendChild(body);
    setTimeout(() => {
      if (!customElements.get('math-field')) {
        const warn = h('div', { className: 'ry-warn', text: 'Math renderer unavailable' });
        root.appendChild(warn);
      }
    }, 50);
  }

  function ensureVega(cb) {
    if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) return cb();
    let doneCalled = false;
    const done = (err) => {
      if (doneCalled) return; doneCalled = true;
      window.removeEventListener('vega-ready', onReady);
      clearTimeout(tid); clearInterval(pid);
      cb(err);
    };
    const onReady = () => {
      if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) done();
    };
    window.addEventListener('vega-ready', onReady);
    const pid = setInterval(onReady, 100);
    const tid = setTimeout(() => done(new Error('vega timeout')), 8000);
  }

  function renderChart(root, chart) {
    root.innerHTML = '';
    const title = h('div', { className: 'ry-title', text: chart.title || 'Chart' });
    const body = h('div', { className: 'ry-body' });
    const target = h('div', { className: 'ry-chart' });
    body.appendChild(target);
    root.appendChild(title);
    root.appendChild(body);

    ensureVega((err) => {
      if (err) {
        target.textContent = 'Chart engine unavailable';
        target.style.color = 'red';
        return;
      }
      const enc = chart.encoding || {};
      const x = enc.x || {}, y = enc.y || {};
      const xField = x.field || 'x';
      const yField = y.field || 'y';
      const xType = (x.type || '').toLowerCase();
      const xScaleType = xType === 'quantitative' ? 'linear' : 'point';
      const values = Array.isArray(chart?.data?.values) ? chart.data.values : [];
      const width = Number(chart.width) > 0 ? Number(chart.width) : 320;
      const height = Number(chart.height) > 0 ? Number(chart.height) : 160;
      const color = Array.isArray(chart.colors) && chart.colors.length ? String(chart.colors[0]) : undefined;
      const enterCommon = { x: { scale: 'x', field: xField }, y: { scale: 'y', field: yField } };
      if (color) {
        if ((chart.mark || 'line') === 'point') enterCommon.fill = { value: color }; else enterCommon.stroke = { value: color };
      }
      const spec = {
        width, height, padding: 8,
        data: [{ name: 'table', values }],
        scales: [
          { name: 'x', type: xScaleType, domain: { data: 'table', field: xField }, range: 'width' },
          { name: 'y', type: 'linear', nice: true, domain: { data: 'table', field: yField }, range: 'height' }
        ],
        axes: [
          { orient: 'bottom', scale: 'x', title: x.title },
          { orient: 'left', scale: 'y', title: y.title }
        ],
        marks: [
          (chart.mark || 'line') === 'point'
            ? { type: 'symbol', from: { data: 'table' }, encode: { enter: { ...enterCommon, size: { value: 60 } } } }
            : { type: 'line', from: { data: 'table' }, encode: { enter: { ...enterCommon, strokeWidth: { value: 2 } } } }
        ]
      };
      try {
        const runtime = window.vega.parse(spec, null, { ast: true });
        const interp = window.__vegaExpressionInterpreter || window.vega.expressionInterpreter;
        const view = new window.vega.View(runtime, { renderer: 'canvas', container: target, hover: true, expr: interp });
        view.runAsync();
      } catch (e) {
        target.textContent = 'Chart render error: ' + e.message;
        target.style.color = 'red';
      }
    });
  }

  function onMessage(ev) {
    const msg = ev.data || {};
    if (msg.type !== 'preview:init') return;
    const root = document.getElementById('root');
    if (!root) return;
    if (msg.nodeType === 'equation') renderEquation(root, msg.data);
    else if (msg.nodeType === 'chart') renderChart(root, msg.data);
  }

  window.addEventListener('message', onMessage);

  // Ask host for data if needed
  if (vscode) vscode.postMessage({ type: 'preview:ready' });
})();
