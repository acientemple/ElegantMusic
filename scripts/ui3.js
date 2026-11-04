const fs = require('fs');
(async () => {
    const list = await (await fetch('http://localhost:9222/json')).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = (method, params) => new Promise((resolve) => {
        const msgId = ++id; pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    const r = await send('Runtime.evaluate', {
        expression: fs.readFileSync(process.argv[2], 'utf8'),
        awaitPromise: true, returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
        console.log('❌ ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    } else {
        const v = r.result?.result?.value;
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    }
    ws.close();
})();
