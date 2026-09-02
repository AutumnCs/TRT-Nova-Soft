const WebSocket = require('ws');
const ports = [19821, 32123, 41559, 44735, 59885];
(async () => {
  for (const port of ports) {
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 2500 });
      const t = setTimeout(() => { try { ws.terminate(); } catch (e) {} resolve(); }, 3000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'App.getPageStack', params: {} }));
      });
      ws.on('message', (raw) => {
        const s = raw.toString().slice(0, 120);
        console.log(`port ${port} => ${s}`);
        clearTimeout(t);
        try { ws.close(); } catch (e) {}
        resolve();
      });
      ws.on('error', () => { clearTimeout(t); resolve(); });
    });
  }
  process.exit(0);
})();
