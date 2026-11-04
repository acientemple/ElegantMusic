// 通过 CDP 截当前页面
const fs = require('fs');
(async () => {
    const list = await (await fetch('http://localhost:9222/json')).json();
    const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = (method, params) => new Promise((res) => {
        const i = ++id;
        const timer = setTimeout(() => res({ timeout: true }), 8000);
        pending.set(i, (m) => { clearTimeout(timer); res(m); });
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send('Page.enable', {});
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    ws.close();
    if (!r.result?.data) { console.log('FAILED: ' + JSON.stringify(r).slice(0, 300)); return; }
    fs.writeFileSync(process.argv[2], Buffer.from(r.result.data, 'base64'));
    console.log('saved ' + process.argv[2]);
})();
