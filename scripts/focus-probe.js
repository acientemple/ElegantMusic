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
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) {
            return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
        }
        return { value: r.result?.result?.value };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1. 页面可见性 / 焦点
    const st = await evaluate(`(() => ({
        visibility: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        innerW: innerWidth, innerH: innerHeight,
        firstRows: Array.from(document.querySelectorAll('.music-list-container tbody tr')).slice(0,4).map(tr => ({
            active: tr.getAttribute('data-active'),
            title: (tr.querySelectorAll('td')[2]?.innerText||'').trim().slice(0,24),
        })),
    }))()`);
    console.log('页面状态: ' + JSON.stringify(st.value, null, 2));

    // 2. 在页面里挂一个原生监听器，验证 CDP 事件是否真的派发到 DOM
    await evaluate(`(() => {
        window.__probe = [];
        document.addEventListener('mousedown', e => window.__probe.push('mousedown:' + e.button + '@' + e.clientX), true);
        document.addEventListener('contextmenu', e => window.__probe.push('contextmenu:' + e.button + '@' + e.clientX), true);
        document.addEventListener('click', e => window.__probe.push('click:' + e.button), true);
        return true;
    })()`);

    const loc = await evaluate(`(() => {
        const tr = Array.from(document.querySelectorAll('.music-list-container tbody tr')).find(t => {
            const td = t.querySelectorAll('td');
            return (td[2]?.innerText || '').trim() && (td[3]?.innerText || '').trim();
        });
        if (!tr) return { error: 'no row' };
        const td = tr.querySelectorAll('td');
        const r = td[2].getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    const p = loc.value;
    console.log('点击坐标: ' + JSON.stringify(p));

    for (const [label, button, buttons] of [['left', 'left', 1], ['right', 'right', 2]]) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 });
        await sleep(500);
    }
    const probe = await evaluate(`(() => ({
        events: window.__probe,
        menuItems: Array.from(document.querySelectorAll('.context-menu--single-column-container .menu-item')).map(m => (m.innerText||'').trim()),
        activeRows: Array.from(document.querySelectorAll('.music-list-container tbody tr[data-active="true"]')).length,
    }))()`);
    console.log('事件探针: ' + JSON.stringify(probe.value, null, 2));
    ws.close();
})();
