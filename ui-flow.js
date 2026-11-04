// 在应用内模拟：右键歌曲 → 点「搜索完整播放版本」→ 读取弹窗内容
const fs = require('fs');

async function send(ws, method, params, idRef) {
    return new Promise((resolve) => {
        const msgId = ++idRef.id;
        idRef.pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}

(async () => {
    const list = await (await fetch('http://localhost:9222/json')).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const idRef = { id: 0, pending: new Map() };
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && idRef.pending.has(msg.id)) {
            idRef.pending.get(msg.id)(msg);
            idRef.pending.delete(msg.id);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res);
        ws.addEventListener('error', rej);
    });

    const evaluate = async (expression) => {
        const r = await send(
            ws,
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            idRef,
        );
        if (r.result?.exceptionDetails) {
            return {
                error:
                    r.result.exceptionDetails.exception?.description ||
                    r.result.exceptionDetails.text,
            };
        }
        return { value: r.result?.result?.value };
    };

    const script = fs.readFileSync(process.argv[2], 'utf8');
    const out = await evaluate(script);
    if (out.error) {
        console.log('❌ ' + out.error);
    } else {
        console.log(
            typeof out.value === 'string'
                ? out.value
                : JSON.stringify(out.value, null, 2),
        );
    }
    ws.close();
})();
