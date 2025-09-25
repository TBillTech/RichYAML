/* Webview bootstrap for RichYAML preview (MVP) */
(function () {
  const vscode = acquireVsCodeApi();
  let lastTree = null;
  let lastFocusedId = null;

  function simpleHash(s) {
    let h = 2166136261 >>> 0; // FNV-1a
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function captureUiState() {
    const scrollables = [];
    const root = document.scrollingElement || document.documentElement;
    if (root) scrollables.push(root);
    const eq = document.getElementById('equations');
    const ch = document.getElementById('charts');
    const raw = document.getElementById('content');
    if (eq) scrollables.push(eq);
    if (ch) scrollables.push(ch);
    if (raw) scrollables.push(raw);
    const snaps = scrollables.map((el) => ({ el, left: el.scrollLeft, top: el.scrollTop }));
    const active = document.activeElement;
    const activeId = active && active.id ? active.id : null;
    return { snaps, activeId };
  }

  function restoreUiState(state) {
    try {
      if (!state) return;
      for (const s of state.snaps || []) {
        if (!s || !s.el) continue;
        try { s.el.scrollLeft = s.left; } catch {}
        try { s.el.scrollTop = s.top; } catch {}
      }
      if (state.activeId) {
        const el = document.getElementById(state.activeId);
        if (el && typeof el.focus === 'function') {
          el.focus({ preventScroll: true });
        }
      } else if (lastFocusedId) {
        const el = document.getElementById(lastFocusedId);
        if (el && typeof el.focus === 'function') {
          el.focus({ preventScroll: true });
        }
      }
    } catch {}
  }

  /** Find !equation or !chart nodes within the parsed tree. */
  function collectNodes(node, tag, path = []) {
    const out = [];
    const isObj = node && typeof node === 'object' && !Array.isArray(node);
    if (isObj && node.$tag === tag) {
      out.push({ path, ...node });
    }
    // Recurse
    if (Array.isArray(node)) {
      node.forEach((it, i) => out.push(...collectNodes(it, tag, path.concat([i]))));
    } else if (isObj) {
      for (const [k, v] of Object.entries(node)) {
        if (k === '$tag' || k === '$items' || k === '$value') continue;
        out.push(...collectNodes(v, tag, path.concat([k])));
      }
      if (node.$items && Array.isArray(node.$items)) {
        node.$items.forEach((it, i) => out.push(...collectNodes(it, tag, path.concat(['$items', i]))));
      }
    }
    return out;
  }

  function renderEquations(tree) {
    const list = document.getElementById('equations');
    if (!list) return;
    list.innerHTML = '';
    const equations = collectNodes(tree, '!equation');
    if (!equations.length) {
      const empty = document.createElement('div');
      empty.className = 'eq-empty';
      empty.textContent = 'No !equation nodes found';
      list.appendChild(empty);
      return;
    }
    equations.forEach((eq, idx) => {
      const card = document.createElement('section');
      card.className = 'eq-card';
      const header = document.createElement('div');
      header.className = 'eq-header';
      header.textContent = eq.desc || `Equation ${idx + 1}`;
      card.appendChild(header);
      const field = document.createElement('div');
      field.className = 'eq-mathfield';
      const mf = document.createElement('math-field');
      try {
        const pathKey = JSON.stringify(eq.path || eq._path || eq.__path || []);
        const hid = 'mf-' + simpleHash(pathKey);
        mf.id = hid;
      } catch {}
      mf.setAttribute('readonly', '');
      mf.setAttribute('virtual-keyboard-mode', 'off');
      const hasLatex = !(eq.latex === undefined || eq.latex === null);
      if (hasLatex) {
        try { mf.value = String(eq.latex); } catch {}
      } else {
        // Task 19.C: latex absent; show mathjson tree and leave math-field blank (transient editing would synthesize)
        try { mf.value = ''; } catch {}
        if (eq.mathjson) {
          const pre = document.createElement('pre');
          pre.className = 'eq-mathjson';
          pre.textContent = JSON.stringify(eq.mathjson, null, 2);
          card.appendChild(pre);
        }
      }
      field.appendChild(mf);
      card.appendChild(field);
      // If MathLive isn't ready yet, show a temporary fallback but keep the math-field
      if (!customElements.get('math-field') && typeof customElements.whenDefined === 'function') {
        const fallback = document.createElement('code');
        fallback.className = 'eq-fallback';
        fallback.textContent = eq.latex ? String(eq.latex) : 'MathJSON';
        field.appendChild(fallback);
        try {
          customElements.whenDefined('math-field').then(() => {
            try { fallback.remove(); } catch {}
            // Ensure value is applied after definition
            try {
              if (!mf.value && eq.latex) mf.value = String(eq.latex);
            } catch {}
          });
        } catch {}
      }
      list.appendChild(card);
    });
  }

  // --- Chart rendering (Vega v6 + vega-interpreter) ---
  function renderCharts(tree) {
    const containerId = 'charts';
    const list = document.getElementById(containerId);
    if (!list) {
      console.error('[RichYAML] Chart container not found in DOM.');
      return;
    }
    // Always show a visible placeholder for the chart area
    list.style.minHeight = '80px';
    list.style.border = '2px dashed #888';
    list.style.marginBottom = '12px';
    list.innerHTML = '';
    var charts = collectNodes(tree, '!chart');
    if (!charts.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = 'No !chart nodes found (placeholder)';
      list.appendChild(empty);
      return;
    }
  console.log('[RichYAML] renderCharts called. charts found:', charts);
  charts.forEach((chart, idx) => {
      const card = document.createElement('section');
      card.className = 'chart-card';
      const header = document.createElement('div');
      header.className = 'chart-header';
      header.textContent = chart.title || `Chart ${idx + 1}`;
      card.appendChild(header);
      const chartDiv = document.createElement('div');
      chartDiv.className = 'chart-vega';
      try {
        const pathKey = JSON.stringify(chart.path || chart._path || chart.__path || []);
        const hid = 'ch-' + simpleHash(pathKey);
        chartDiv.id = hid;
      } catch {}
      card.appendChild(chartDiv);
      // Build a minimal Vega spec from the !chart node
      const buildSpec = (c) => {
        const width = Number(c.width) > 0 ? Number(c.width) : 360;
        const height = Number(c.height) > 0 ? Number(c.height) : 180;
        const dataValues = c?.data?.values && Array.isArray(c.data.values) ? c.data.values : [];
        const enc = c?.encoding || {};
        const xEnc = enc.x || {};
        const yEnc = enc.y || {};
        const xField = xEnc.field || 'x';
        const yField = yEnc.field || 'y';
  const xType = (xEnc.type || '').toLowerCase();
  const mark = (c.mark || 'line').toString().toLowerCase();
  // Use band scale for bar charts regardless of x type for visibility/consistency
  const xScaleType = (mark === 'bar') ? 'band' : (xType === 'quantitative' ? 'linear' : 'point');
        const color = Array.isArray(c.colors) && c.colors.length ? String(c.colors[0]) : undefined;
        const axisX = { orient: 'bottom', scale: 'x' };
        if (xEnc.title) axisX.title = String(xEnc.title);
        const axisY = { orient: 'left', scale: 'y' };
        if (yEnc.title) axisY.title = String(yEnc.title);
        const spec = {
          width,
          height,
          padding: 10,
          data: [{ name: 'table', values: dataValues }],
          scales: [
            { name: 'x', type: xScaleType, domain: { data: 'table', field: xField }, range: 'width' },
            { name: 'y', type: 'linear', nice: true, domain: { data: 'table', field: yField }, range: 'height' }
          ],
          axes: [axisX, axisY],
        };
        // Build marks by mark type
        if (mark === 'point') {
          const encEnter = { x: { scale: 'x', field: xField }, y: { scale: 'y', field: yField }, size: { value: 60 } };
          if (color) encEnter.fill = { value: color };
          spec.marks = [{ type: 'symbol', from: { data: 'table' }, encode: { enter: encEnter } }];
  } else if (mark === 'bar' && xScaleType === 'band') {
          const barEnter = {
            x: { scale: 'x', field: xField },
            width: { scale: 'x', band: 1 },
            y: { scale: 'y', field: yField },
            y2: { scale: 'y', value: 0 }
          };
          if (color) barEnter.fill = { value: color };
          spec.marks = [{ type: 'rect', from: { data: 'table' }, encode: { enter: barEnter } }];
        } else {
          const lineEnter = { x: { scale: 'x', field: xField }, y: { scale: 'y', field: yField }, strokeWidth: { value: 2 } };
          if (color) lineEnter.stroke = { value: color };
          spec.marks = [{ type: 'line', from: { data: 'table' }, encode: { enter: lineEnter } }];
        }
        return spec;
      };
  const vegaSpec = buildSpec(chart);
      console.log('[RichYAML] chart -> Vega spec:', vegaSpec);
      // Try to find an interpreter candidate
      const findInterpreter = () => (
        window.__vegaExpressionInterpreter ||
        (window.vega && window.vega.expressionInterpreter) ||
        window.expressionInterpreter ||
        (window.vegaInterpreter && window.vegaInterpreter.expressionInterpreter)
      );
      const interpreter = findInterpreter();
      if (window.vega && window.vega.View && interpreter) {
        try {
          // Enable AST output for CSP-safe interpreter
          const runtime = window.vega.parse(vegaSpec, null, { ast: true });
          const view = new window.vega.View(runtime, {
            renderer: 'canvas',
            container: chartDiv,
            hover: true,
            expr: interpreter
          });
          view.runAsync();
        } catch (err) {
          chartDiv.textContent = 'Chart render error: ' + err;
          chartDiv.style.color = 'red';
          console.error('[RichYAML] Chart render error (Vega v6 + interpreter):', err, vegaSpec, chart);
        }
      } else {
        chartDiv.textContent = 'Chart renderer not available (Vega/interpreter missing)';
        chartDiv.style.color = 'red';
        console.error('[RichYAML] Renderer missing. window.vega:', window.vega, 'interpreter:', interpreter);
      }
      list.appendChild(card);

      // If chart refers to workspace data.file, ask host to resolve and then re-render this card
      try {
        const file = chart && chart.data && chart.data.file;
        if (typeof file === 'string' && file.trim()) {
          const path = chart.path || chart._path || chart.__path || null;
          const onMsg = (ev) => {
            const m = ev.data || {};
            if (!m || !m.type) return;
            const samePath = JSON.stringify(m.path) === JSON.stringify(path);
            if (m.type === 'data:resolved' && samePath) {
              window.removeEventListener('message', onMsg);
              try {
                const updated = Object.assign({}, chart, { data: Object.assign({}, chart.data || {}, { values: Array.isArray(m.values) ? m.values : [] }) });
                // Rebuild spec and re-render view
                chartDiv.innerHTML = '';
                const spec2 = buildSpec(updated);
                const runtime2 = window.vega.parse(spec2, null, { ast: true });
                const view2 = new window.vega.View(runtime2, {
                  renderer: 'canvas', container: chartDiv, hover: true, expr: interpreter
                });
                view2.runAsync();
              } catch (e2) {
                chartDiv.textContent = 'Chart render error after data load: ' + e2;
                chartDiv.style.color = 'red';
              }
            } else if (m.type === 'data:error' && samePath) {
              window.removeEventListener('message', onMsg);
              const err = document.createElement('div');
              err.style.color = 'red';
              err.textContent = 'Data error: ' + (m.error || 'unknown');
              card.appendChild(err);
            }
          };
          window.addEventListener('message', onMsg);
          vscode.postMessage({ type: 'data:request', path: path, file });
        }
      } catch {}
    });
  }

  // Wait for the vega-shim module to provide Vega + interpreter
  function loadVegaEmbed(cb) {
    if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) return cb();
    let doneCalled = false;
    const done = (err) => {
      if (doneCalled) return;
      doneCalled = true;
      window.removeEventListener('vega-ready', onReady);
      clearTimeout(timeoutId);
      clearInterval(pollId);
      cb(err);
    };
    const onReady = () => {
      if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) {
        done();
      }
    };
    window.addEventListener('vega-ready', onReady);
    // Poll as a fallback in case the event fired before listener was attached
    const pollId = setInterval(() => {
      if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) {
        done();
      }
    }, 200);
    // Also set a timeout to fail gracefully if shim can't load (e.g., CDN blocked)
    const timeoutId = setTimeout(() => {
      if (window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) {
        done();
      } else {
        done(new Error('Timed out waiting for Vega module shim'));
      }
    }, 10000);
  }

  function handleMessage(event) {
    try {
      const msg = event.data || {};
      if (msg.type === 'preview:error') {
        const eq = document.getElementById('equations');
        const ch = document.getElementById('charts');
        if (eq) eq.innerHTML = '';
        if (ch) ch.innerHTML = '';
        const content = document.getElementById('content');
        if (content) {
          content.textContent = (msg.error ? ('Invalid YAML: ' + msg.error) : 'Invalid YAML') + '\n';
        }
        // Show prominent banner
        let container = document.querySelector('.container');
        if (container && !container.querySelector('.ry-error')) {
          const div = document.createElement('div');
          div.className = 'ry-error';
          div.setAttribute('role','alert');
          div.textContent = msg.error || 'Invalid YAML';
          div.style.cssText='margin:8px; padding:8px 10px; background:var(--vscode-inputValidation-errorBackground,#5a1d1d); color:var(--vscode-inputValidation-errorForeground,#fff); border-left:4px solid var(--vscode-errorForeground,#f00); font-size:13px; border-radius:4px;';
          container.prepend(div);
        }
        return;
      }
      if (msg.type === 'document:update') {
        // Capture state to avoid scroll/focus jumps on update
        const ui = captureUiState();
        const activeEl = document.activeElement;
        lastFocusedId = activeEl && activeEl.id ? activeEl.id : lastFocusedId;
        lastTree = msg.tree;
        const el = document.getElementById('content');
        if (el) {
          let output = '';
          if (msg.error) {
            output += `YAML parse error: ${msg.error}\n\n`;
          }
          output += msg.text ?? '';
          output += '\n\n--- Parsed preview ---\n';
          try {
            output += JSON.stringify(msg.tree ?? null, null, 2);
          } catch {
            output += String(msg.tree);
          }
          el.textContent = output;
        }
        renderEquations(msg.tree);
        // Always load Vega + interpreter before rendering charts
        loadVegaEmbed(function(err) {
          if (err) {
            const chartList = document.getElementById('charts');
            if (chartList) {
              chartList.innerHTML = '';
              const errorDiv = document.createElement('div');
              errorDiv.style.color = 'red';
              errorDiv.textContent = 'Failed to load chart renderer: ' + err.message;
              chartList.appendChild(errorDiv);
            }
            console.error('[RichYAML] Failed to load chart renderer:', err);
            // Restore UI even on error
            restoreUiState(ui);
            return;
          }
          console.log('[RichYAML] Vega + interpreter loaded. window.vega:', window.vega);
          renderCharts(msg.tree);
          // Restore UI after re-render
          restoreUiState(ui);
        });
      }
    } catch (err) {
      const el = document.getElementById('content');
      if (el) {
        el.textContent = 'Webview error: ' + (err && err.message ? err.message : String(err));
      }
      const chartList = document.getElementById('charts');
      if (chartList) {
        chartList.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.textContent = 'Webview error: ' + (err && err.message ? err.message : String(err));
        chartList.appendChild(errorDiv);
      }
      console.error('[RichYAML] Webview error:', err);
    }
  }

  // Listen for extension -> webview messages
  window.addEventListener('message', handleMessage);

  // If vega-shim finishes after initial load, re-render charts with latest tree
  window.addEventListener('vega-ready', () => {
    try {
      if (lastTree) {
        const ui = captureUiState();
        console.log('[RichYAML] vega-ready received; re-rendering charts');
        renderCharts(lastTree);
        restoreUiState(ui);
      }
    } catch (e) {
      console.error('[RichYAML] Error on vega-ready re-render:', e);
    }
  });

  // Request initial render
  vscode.postMessage({ type: 'preview:request' });
})();
