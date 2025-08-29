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

  function renderEquation(root, data, path) {
    root.innerHTML = '';
    const title = h('div', { className: 'ry-title', text: data.desc || 'Equation' });
    const body = h('div', { className: 'ry-body' });
    const mf = document.createElement('math-field');
    // Make editable for two-way MVP
    mf.removeAttribute('readonly');
    mf.setAttribute('virtual-keyboard-mode', 'manual');
    try { mf.value = data.latex ? String(data.latex) : '\\text{MathJSON}'; } catch {}
    body.appendChild(mf);
    if (!data.latex && data.mathjson) {
      const pre = h('pre', { className: 'ry-json' }, JSON.stringify(data.mathjson, null, 2));
      body.appendChild(pre);
    }
    root.appendChild(title);
    root.appendChild(body);
    // Debounced change -> host edit apply
    let t;
    const send = () => {
      if (!vscode) return;
      const payload = { type: 'edit:apply', path, key: 'latex', edit: 'set', value: mf.value || '' };
      vscode.postMessage(payload);
    };
    const onInput = () => { clearTimeout(t); t = setTimeout(send, 300); };
    mf.addEventListener('input', onInput);
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

  function renderChart(root, chart, path) {
    root.innerHTML = '';
    const title = h('div', { className: 'ry-title', text: chart.title || 'Chart' });
    const body = h('div', { className: 'ry-body' });
    // -- Minimal controls --
    const controls = h('div', { className: 'ry-controls' });
    const row = (label, control) => {
      const wrap = h('div', { className: 'ry-row' });
      wrap.appendChild(h('label', { className: 'ry-lbl', text: label }));
      wrap.appendChild(control);
      return wrap;
    };
    const input = (val, placeholder) => {
      const el = h('input', { type: 'text' });
      el.value = val != null ? String(val) : '';
      if (placeholder) el.placeholder = placeholder;
      return el;
    };
    const select = (opts, val) => {
      const el = h('select');
      for (const o of opts) {
        const opt = h('option', { value: o, text: o });
        if (String(val) === o) opt.selected = true;
        el.appendChild(opt);
      }
      return el;
    };
    const markSel = select(['line', 'bar', 'point'], chart.mark || 'line');
    const titleInp = input(chart.title, 'Title');
    const xFieldInp = input(chart?.encoding?.x?.field || '', 'x field');
    const xTypeSel = select(['quantitative', 'nominal', 'temporal', 'ordinal'], (chart?.encoding?.x?.type || 'quantitative'));
    const yFieldInp = input(chart?.encoding?.y?.field || '', 'y field');
    const yTypeSel = select(['quantitative', 'nominal', 'temporal', 'ordinal'], (chart?.encoding?.y?.type || 'quantitative'));
    controls.appendChild(row('Title', titleInp));
    controls.appendChild(row('Mark', markSel));
    controls.appendChild(row('X Field', xFieldInp));
    controls.appendChild(row('X Type', xTypeSel));
    controls.appendChild(row('Y Field', yFieldInp));
    controls.appendChild(row('Y Type', yTypeSel));
    const hint = h('div', { className: 'ry-hint' });
    controls.appendChild(hint);
    const target = h('div', { className: 'ry-chart' });
    body.appendChild(target);
    body.appendChild(controls);
    root.appendChild(title);
    root.appendChild(body);

    // Validation helpers
    const allowedMarks = new Set(['line', 'bar', 'point']);
    const allowedTypes = new Set(['quantitative', 'nominal', 'temporal', 'ordinal']);
    const showError = (msg) => { hint.textContent = msg || ''; hint.style.color = msg ? 'var(--vscode-errorForeground, red)' : ''; };
    const sendEdit = (propPath, value) => {
      if (!vscode) return;
      vscode.postMessage({ type: 'edit:apply', path, propPath, edit: 'set', value });
    };
    const onTitleChange = () => {
      const v = titleInp.value.trim();
      if (!v) { showError('Title required'); return; }
      showError('');
      sendEdit(['title'], v);
    };
    const onMarkChange = () => {
      const v = String(markSel.value || '').toLowerCase();
      if (!allowedMarks.has(v)) { showError('Invalid mark'); return; }
      showError('');
      sendEdit(['mark'], v);
    };
    const onXFieldChange = () => {
      const v = xFieldInp.value.trim();
      if (!v) { showError('x.field required'); return; }
      showError('');
      sendEdit(['encoding', 'x', 'field'], v);
    };
    const onXTypeChange = () => {
      const v = String(xTypeSel.value || '').toLowerCase();
      if (!allowedTypes.has(v)) { showError('Invalid x.type'); return; }
      showError('');
      sendEdit(['encoding', 'x', 'type'], v);
    };
    const onYFieldChange = () => {
      const v = yFieldInp.value.trim();
      if (!v) { showError('y.field required'); return; }
      showError('');
      sendEdit(['encoding', 'y', 'field'], v);
    };
    const onYTypeChange = () => {
      const v = String(yTypeSel.value || '').toLowerCase();
      if (!allowedTypes.has(v)) { showError('Invalid y.type'); return; }
      showError('');
      sendEdit(['encoding', 'y', 'type'], v);
    };
    titleInp.addEventListener('change', onTitleChange);
    titleInp.addEventListener('blur', onTitleChange);
    markSel.addEventListener('change', onMarkChange);
    xFieldInp.addEventListener('change', onXFieldChange);
    xFieldInp.addEventListener('blur', onXFieldChange);
    xTypeSel.addEventListener('change', onXTypeChange);
    yFieldInp.addEventListener('change', onYFieldChange);
    yFieldInp.addEventListener('blur', onYFieldChange);
    yTypeSel.addEventListener('change', onYTypeChange);

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
    if (msg.nodeType === 'equation') renderEquation(root, msg.data, msg.path);
    else if (msg.nodeType === 'chart') renderChart(root, msg.data, msg.path);
  }

  window.addEventListener('message', onMessage);

  // Ask host for data if needed
  if (vscode) vscode.postMessage({ type: 'preview:ready' });
})();
