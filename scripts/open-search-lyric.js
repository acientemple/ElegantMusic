// 右键 MusicDetail 的歌词 → 点「搜索歌词」→ 抓取弹窗状态
(async () => {
    const list = await (await fetch('http://127.0.0.1:9222/json')).json();
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
    const mouse = async (type, x, y, button, buttons) =>
        send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });

    // 1. 右键歌词区
    const lc = await evaluate(`(() => {
        const el = document.querySelector('.music-detail--container .lyric-container');
        if (!el) return { error: 'no .lyric-container' };
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
    })()`);
    if (lc.error || lc.value?.error) { console.log('❌ ' + (lc.error || lc.value.error)); ws.close(); return; }
    const p = lc.value;
    await mouse('mouseMoved', p.x, p.y, 'none', 0);
    await mouse('mousePressed', p.x, p.y, 'right', 2);
    await sleep(120);
    await mouse('mouseReleased', p.x, p.y, 'right', 0);
    await sleep(900);

    // 2. 找到「搜索歌词」并点击
    const hit = await evaluate(`(() => {
        const all = Array.from(document.querySelectorAll('div,span'));
        const cand = all.filter(e => {
            const t = (e.innerText || '').trim();
            if (!t || t.length > 12) return false;
            if (!/搜索歌词|智能匹配/.test(t)) return false;
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        if (!cand.length) {
            // 列出当前可见菜单项，方便排查
            const menus = Array.from(document.querySelectorAll('[class*="menu"]'))
                .filter(e => e.getBoundingClientRect().width > 0)
                .map(e => e.className + ' :: ' + (e.innerText||'').trim().replace(/\\n/g, ' / ').slice(0, 120));
            return { error: 'menu item not found', menus };
        }
        const el = cand[cand.length - 1];
        const r = el.getBoundingClientRect();
        return { text: (el.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, count: cand.length };
    })()`);
    if (hit.error || hit.value?.error) {
        console.log('❌ ' + (hit.error || hit.value.error));
        console.log(JSON.stringify(hit.value?.menus ?? [], null, 2));
        ws.close(); return;
    }
    console.log('菜单项: ' + JSON.stringify(hit.value));
    await mouse('mouseMoved', hit.value.x, hit.value.y, 'none', 0);
    await mouse('mousePressed', hit.value.x, hit.value.y, 'left', 1);
    await mouse('mouseReleased', hit.value.x, hit.value.y, 'left', 0);
    await sleep(1500);

    const modal = await evaluate(`(() => {
        const m = document.querySelector('.modal--search-lyric-container');
        if (!m) return { found: false, modals: Array.from(document.querySelectorAll('[class*="modal--"]')).map(e => e.className) };
        const input = m.querySelector('.search-lyric-input');
        return {
            found: true,
            inputValue: input ? input.value : null,
            tabs: Array.from(m.querySelectorAll('.tab-list-item')).map(e => (e.innerText||'').trim()),
            panels: Array.from(m.querySelectorAll('.tab-panel-container')).map(p => ({
                visible: p.getBoundingClientRect().height > 0,
                items: Array.from(p.querySelectorAll('.lyric-item')).map(e => {
                    const t = e.querySelector('.title');
                    const a = e.querySelector('.artist');
                    return { title: (t?.innerText||'').trim(), artist: (a?.innerText||'').trim() };
                }).slice(0, 5),
                count: p.querySelectorAll('.lyric-item').length,
                empty: !!p.querySelector('[class*="empty"]'),
            })),
        };
    })()`);
    console.log('弹窗: ' + JSON.stringify(modal.value, null, 2));
    ws.close();
})();
