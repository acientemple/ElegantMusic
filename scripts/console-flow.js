// 抓渲染进程 console，跑一遍「搜索歌词」流程
const fs = require('fs');
(async () => {
    const list = await (await fetch('http://127.0.0.1:9222/json')).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
        if (msg.method === 'Runtime.consoleAPICalled') {
            const text = (msg.params.args || [])
                .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
                .join(' ');
            logs.push(`[${msg.params.type}] ${text}`);
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
        }
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
    const mouse = async (type, x, y, button, buttons, clickCount = 1) =>
        send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });

    await send('Runtime.enable', {});
    await send('Log.enable', {});

    // 打开 MusicDetail
    await evaluate(`(() => {
        const el = document.querySelector('.open-detail');
        if (el) el.click();
        return true;
    })()`);
    await sleep(1200);

    const cur = await evaluate(`(() => ({
        detail: (document.querySelector('.music-detail--container .music-title')?.innerText || '').trim(),
        bar: (document.querySelector('.music-info .music-title span')?.innerText || '').trim(),
        btns: Array.from(document.querySelectorAll('.music-detail--container .lyric-item.search-lyric')).map(e => (e.innerText||'').trim()),
    }))()`);
    console.log('当前: ' + JSON.stringify(cur.value));

    const which = process.argv[2] || '搜索歌词';
    const hit = await evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('.music-detail--container .lyric-item.search-lyric'));
        const el = btns.find(e => (e.innerText||'').trim() === ${JSON.stringify(which)});
        if (!el) return { error: 'button not found', all: btns.map(e => (e.innerText||'').trim()) };
        el.click();
        return { text: (el.innerText||'').trim() };
    })()`);
    if (hit.value?.error) { console.log('❌ ' + hit.value.error + ' ' + JSON.stringify(hit.value.all)); ws.close(); return; }
    console.log('点击: ' + hit.value.text);
    await sleep(+(process.argv[3] || 10000));

    const state = await evaluate(`(() => {
        const m = document.querySelector('.modal--search-lyric-container');
        if (!m) return { modal: false, all: Array.from(document.querySelectorAll('[class*="modal"]')).map(e=>e.className).slice(0,8) };
        return {
            modal: true,
            input: m.querySelector('input')?.value ?? null,
            tabs: Array.from(m.querySelectorAll('.tab-list-item')).map(e => (e.innerText||'').trim()),
            panels: Array.from(m.querySelectorAll('.tab-panel-container')).map(p => ({
                visible: p.getBoundingClientRect().height > 0,
                count: p.querySelectorAll('.lyric-item').length,
                items: Array.from(p.querySelectorAll('.lyric-item')).map(e => ({
                    title: (e.querySelector('.title')?.innerText||'').trim(),
                    artist: (e.querySelector('.artist')?.innerText||'').trim(),
                })).slice(0, 4),
            })),
        };
    })()`);
    console.log('状态: ' + JSON.stringify(state.value, null, 2));

    console.log('\n===== console =====');
    logs.slice(-80).forEach((l) => console.log(l.slice(0, 400)));
    ws.close();
})();
