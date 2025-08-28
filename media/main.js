/* Webview bootstrap for RichYAML preview (MVP) */
(function () {
  const vscode = acquireVsCodeApi();

  function handleMessage(event) {
    const msg = event.data || {};
    if (msg.type === 'preview:update') {
      const el = document.getElementById('content');
      if (el) el.textContent = msg.text ?? '';
    }
  }

  window.addEventListener('message', handleMessage);

  // Request initial render
  vscode.postMessage({ type: 'preview:request' });
})();
