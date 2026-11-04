// 探测：CDP 鼠标事件在应用里是否生效 + 右键菜单是否弹出
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

    const loc = await evaluate(`(() => {
        const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
        const tr = trs.find(t => {
            const td = t.querySelectorAll('td');
            return (td[2]?.innerText || '').trim() && (td[3]?.innerText || '').trim();
        });
        if (!tr) return { error: 'no row' };
        const td = tr.querySelectorAll('td');
        const r = td[2].getBoundingClientRect();
        return { title: (td[2].innerText||'').trim(), artist: (td[3].innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (loc.error) { console.log('❌ ' + loc.error); ws.close(); return; }
    const p = loc.value;
    console.log(`目标: ${p.title} — ${p.artist} @ (${Math.round(p.x)}, ${Math.round(p.y)})`);

    // A. 先左键点击，验证鼠标事件是否生效（行是否被选中）
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    await sleep(600);
    const afterLeft = await evaluate(`(() => {
        const active = document.querySelectorAll('.music-list-container tbody tr[data-active="true"]');
        return { activeCount: active.length, activeTitle: active[0]?.querySelectorAll('td')[2]?.innerText?.trim() || '' };
    })()`);
    console.log('左键后选中行: ' + JSON.stringify(afterLeft.value));

    // B. 右键：mouseMoved + pressed(right,buttons=2) + released(right,buttons=0)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1, pointerType: 'mouse' });
    await sleep(200);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    await sleep(1000);
    const menu = await evaluate(`(() => {
        const c = document.querySelector('.context-menu--single-column-container');
        return {
            exists: !!c,
            items: c ? Array.from(c.querySelectorAll('.menu-item')).map(m => (m.innerText||'').trim()) : [],
        };
    })()`);
    console.log('右键菜单: ' + JSON.stringify(menu.value, null, 2));
    ws.close();
})();
