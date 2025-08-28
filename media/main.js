/* Webview bootstrap for RichYAML preview (MVP) */
(function () {
  const vscode = acquireVsCodeApi();

  /** Find !equation nodes within the parsed tree. Supports shapes produced by yamlService.toPlainWithTags */
  function collectEquations(node, path = []) {
    const out = [];
    const isObj = node && typeof node === 'object' && !Array.isArray(node);
    if (isObj && node.$tag === '!equation') {
      const mathjson = node.mathjson ?? node.$value ?? null;
      const latex = node.latex ?? null;
      const desc = node.desc ?? null;
      out.push({ path, mathjson, latex, desc });
    }
    // Recurse
    if (Array.isArray(node)) {
      node.forEach((it, i) => out.push(...collectEquations(it, path.concat([i]))));
    } else if (isObj) {
      for (const [k, v] of Object.entries(node)) {
        if (k === '$tag' || k === '$items' || k === '$value') continue;
        out.push(...collectEquations(v, path.concat([k])));
      }
      if (node.$items && Array.isArray(node.$items)) {
        node.$items.forEach((it, i) => out.push(...collectEquations(it, path.concat(['$items', i]))));
      }
    }
    return out;
  }

  function renderEquations(tree) {
    const list = document.getElementById('equations');
    if (!list) return;
    list.innerHTML = '';
    const equations = collectEquations(tree);
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
      mf.setAttribute('readonly', '');
      mf.setAttribute('virtual-keyboard-mode', 'off');
      const latexInput = eq.latex || undefined;
      if (latexInput) {
        // Set immediately; the web component will pick it up when upgraded.
        try { mf.value = String(latexInput); } catch {}
      } else {
        // No LaTeX: show a placeholder and pretty-print MathJSON below.
        try { mf.value = '\\text{MathJSON node}'; } catch {}
        if (eq.mathjson) {
          const pre = document.createElement('pre');
          pre.className = 'eq-mathjson';
          pre.textContent = JSON.stringify(eq.mathjson, null, 2);
          card.appendChild(pre);
        }
      }
      field.appendChild(mf);
      card.appendChild(field);

      // If MathLive failed to load, provide a small fallback text.
      setTimeout(() => {
        if (!customElements.get('math-field')) {
          const warn = document.createElement('div');
          warn.className = 'eq-error';
          warn.textContent = 'Math renderer unavailable (MathLive not loaded)';
          card.appendChild(warn);
        }
      }, 200);

      list.appendChild(card);
    });
  }

  function handleMessage(event) {
    const msg = event.data || {};
    if (msg.type === 'document:update') {
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
      // Render equations section
      renderEquations(msg.tree);
    }
  }

  window.addEventListener('message', handleMessage);

  // Request initial render
  vscode.postMessage({ type: 'preview:request' });
})();
