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
  const hasMath = !!customElements.get('math-field');
    // Keep the equation very compact: no title; just the content
    const body = h('div', { className: 'ry-body ry-body-eq', role: 'group', 'aria-label': hasMath ? 'Equation editor' : 'Equation preview' });
    let tsz;
    const postSizeSoon = () => {
      clearTimeout(tsz);
      tsz = setTimeout(() => {
        try {
          const rect = root.getBoundingClientRect();
          const desired = Math.ceil(rect.height);
          if (vscode) vscode.postMessage({ type: 'size', heightPx: desired });
        } catch {}
      }, 16);
    };
  if (hasMath) {
      const mf = document.createElement('math-field');
      // Make editable for two-way MVP
      mf.removeAttribute('readonly');
      mf.setAttribute('virtual-keyboard-mode', 'manual');
      mf.setAttribute('aria-label', 'Equation latex editor');
      try { mf.value = data.latex ? String(data.latex) : '\\text{MathJSON}'; } catch {}
      body.appendChild(mf);
      if (!data.latex && data.mathjson) {
        const pre = h('pre', { className: 'ry-json', role: 'region', 'aria-label': 'Equation MathJSON' }, JSON.stringify(data.mathjson, null, 2));
        body.appendChild(pre);
      }
      root.appendChild(body);
      // Debounced change -> host edit apply
      let t;
      const send = () => {
        if (!vscode) return;
        const payload = { type: 'edit:apply', path, key: 'latex', edit: 'set', value: mf.value || '' };
        vscode.postMessage(payload);
      };
      const onInput = () => { clearTimeout(t); t = setTimeout(send, 200); postSizeSoon(); };
      mf.addEventListener('input', onInput);
      mf.addEventListener('keydown', (e) => {
        // Accessibility: Esc or Ctrl+Enter returns focus to container/editor
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          try { (root.closest('[tabindex]') || root).focus(); } catch {}
          if (vscode) vscode.postMessage({ type: 'focus:return' });
        }
      });
      setTimeout(() => {
        postSizeSoon();
        // Track subsequent size changes
        try {
          if ('ResizeObserver' in window) {
            const ro = new ResizeObserver(() => postSizeSoon());
            ro.observe(root);
          }
        } catch {}
      }, 50);
    } else {
      // Fallback until MathLive defines <math-field>, but keep room and upgrade when ready
      const mf = document.createElement('math-field');
      mf.setAttribute('readonly', '');
      try { mf.value = data.latex ? String(data.latex) : '\text{MathJSON}'; } catch {}
      body.appendChild(mf);
      const code = h('code', { className: 'ry-fallback' }, data.latex ? String(data.latex) : 'MathJSON');
      body.appendChild(code);
      if (!data.latex && data.mathjson) {
        const pre = h('pre', { className: 'ry-json', role: 'region', 'aria-label': 'Equation MathJSON' }, JSON.stringify(data.mathjson, null, 2));
        body.appendChild(pre);
      }
      root.appendChild(body);
      try {
        if (typeof customElements.whenDefined === 'function') {
          customElements.whenDefined('math-field').then(() => {
            try { code.remove(); } catch {}
            postSizeSoon();
          });
        }
      } catch {}
      setTimeout(() => postSizeSoon(), 20);
    }
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
  const title = h('div', { className: 'ry-title', text: chart.title || 'Chart', role: 'heading', 'aria-level': '3' });
  const body = h('div', { className: 'ry-body ry-body-chart', role: 'group', 'aria-label': 'Chart preview and controls' });
    // -- Minimal controls --
    const controls = h('div', { className: 'ry-controls' });
    const row = (label, control, id) => {
      const wrap = h('div', { className: 'ry-row', role: 'group' });
      const lbl = h('label', { className: 'ry-lbl', text: label, for: id });
      control.id = id;
      control.setAttribute('aria-label', label);
      wrap.appendChild(lbl);
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
  controls.appendChild(row('Title', titleInp, 'ry-title'));
  controls.appendChild(row('Mark', markSel, 'ry-mark'));
  controls.appendChild(row('X Field', xFieldInp, 'ry-xfield'));
  controls.appendChild(row('X Type', xTypeSel, 'ry-xtype'));
  controls.appendChild(row('Y Field', yFieldInp, 'ry-yfield'));
  controls.appendChild(row('Y Type', yTypeSel, 'ry-ytype'));
  const hint = h('div', { className: 'ry-hint', role: 'status', 'aria-live': 'polite' });
    controls.appendChild(hint);
  const target = h('div', { className: 'ry-chart', role: 'img', 'aria-label': 'Chart preview' });
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
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        try { (root.closest('[tabindex]') || root).focus(); } catch {}
        if (vscode) vscode.postMessage({ type: 'focus:return' });
      }
    });

    // If data.file provided, ask host to resolve; then render with values
    const maybeRequestData = (cb) => {
      const file = chart && chart.data && chart.data.file;
      if (vscode && typeof file === 'string' && file.trim()) {
        // Remove any previous data listener to avoid stacking
        if (root.__dataListener) {
          try { window.removeEventListener('message', root.__dataListener); } catch {}
          root.__dataListener = null;
        }
        const onMsg = (ev) => {
          const m = ev.data || {};
          if (!m || !m.type) return;
          if (m.type === 'data:resolved' && JSON.stringify(m.path) === JSON.stringify(path)) {
            window.removeEventListener('message', onMsg);
            const next = { ...chart, data: { ...(chart.data || {}), values: Array.isArray(m.values) ? m.values : [] } };
            cb(null, next);
          } else if (m.type === 'data:error' && JSON.stringify(m.path) === JSON.stringify(path)) {
            window.removeEventListener('message', onMsg);
            hint.textContent = 'Data error: ' + (m.error || 'unknown');
            hint.style.color = 'var(--vscode-errorForeground, red)';
            cb(new Error(m.error || 'data error'));
          }
        };
        root.__dataListener = onMsg;
        window.addEventListener('message', onMsg);
        vscode.postMessage({ type: 'data:request', path, file });
      } else {
        cb(null, chart);
      }
    };

    const postSizeSoon = () => {
      try {
        const rect = root.getBoundingClientRect();
        const h = Math.ceil(rect.height);
        if (vscode) vscode.postMessage({ type: 'size', heightPx: h });
      } catch {}
    };

    ensureVega((err) => {
      if (err) {
        target.textContent = 'Chart engine unavailable';
        target.style.color = 'red';
        return;
      }
      const renderWith = (c) => {
        const enc = c.encoding || {};
        const x = enc.x || {}, y = enc.y || {};
        const xField = x.field || 'x';
        const yField = y.field || 'y';
        const xType = (x.type || '').toLowerCase();
        const markType = String(c.mark || 'line').toLowerCase();
        // Use band scale for bar charts regardless of x type for visibility
        const xScaleType = markType === 'bar' ? 'band' : (xType === 'quantitative' ? 'linear' : 'point');
        const values = Array.isArray(c?.data?.values) ? c.data.values : [];
        const width = Number(c.width) > 0 ? Number(c.width) : 320;
        const height = Number(c.height) > 0 ? Number(c.height) : 160;
        const color = Array.isArray(c.colors) && c.colors.length ? String(c.colors[0]) : undefined;
        const enterCommon = { x: { scale: 'x', field: xField }, y: { scale: 'y', field: yField } };
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
          ]
        };
        // Build marks according to markType
        if (markType === 'point') {
          const encEnter = { ...enterCommon, size: { value: 60 } };
          if (color) encEnter.fill = { value: color };
          spec.marks = [
            { type: 'symbol', from: { data: 'table' }, encode: { enter: encEnter } }
          ];
        } else if (markType === 'bar' && xScaleType === 'band') {
          const barEnter = {
            x: { scale: 'x', field: xField },
            width: { scale: 'x', band: 1 },
            y: { scale: 'y', field: yField },
            y2: { scale: 'y', value: 0 }
          };
          if (color) barEnter.fill = { value: color };
          spec.marks = [
            { type: 'rect', from: { data: 'table' }, encode: { enter: barEnter } }
          ];
        } else {
          // default to line (including bar+quantitative x fallback)
          const lineEnter = { ...enterCommon, strokeWidth: { value: 2 } };
          if (color) lineEnter.stroke = { value: color };
          spec.marks = [
            { type: 'line', from: { data: 'table' }, encode: { enter: lineEnter } }
          ];
        }
        try {
          const runtime = window.vega.parse(spec, null, { ast: true });
          const interp = window.__vegaExpressionInterpreter || window.vega.expressionInterpreter;
          const view = new window.vega.View(runtime, { renderer: 'canvas', container: target, hover: true, expr: interp });
          view.runAsync().then(() => {
            // Report size after render
            postSizeSoon();
            // Observe subsequent changes
            try {
              if ('ResizeObserver' in window) {
                const ro = new ResizeObserver(() => postSizeSoon());
                ro.observe(root);
              }
            } catch {}
          });
        } catch (e) {
          target.textContent = 'Chart render error: ' + e.message;
          target.style.color = 'red';
        }
      };
      maybeRequestData((e2, c2) => {
        if (e2) return; // error already shown in hint
        renderWith(c2);
      });
    });
  }

  function onMessage(ev) {
    const msg = ev.data || {};
    if (msg.type !== 'preview:init' && msg.type !== 'preview:update') return;
    const root = document.getElementById('root');
    if (!root) return;
    if (msg.nodeType === 'equation') renderEquation(root, msg.data, msg.path);
    else if (msg.nodeType === 'chart') renderChart(root, msg.data, msg.path);
  }

  window.addEventListener('message', onMessage);

  // Ask host for data if needed
  if (vscode) vscode.postMessage({ type: 'preview:ready' });
})();
