/* Webview bootstrap for RichYAML preview (MVP) */
(function () {
  const vscode = acquireVsCodeApi();

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
    }
  }

  window.addEventListener('message', handleMessage);

  // Request initial render
  vscode.postMessage({ type: 'preview:request' });
})();
