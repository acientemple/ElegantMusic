// 点「搜索歌词」/「智能匹配歌词」按钮 → 抓弹窗状态
const fs = require('fs');
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
    const mouse = async (type, x, y, button, buttons, clickCount = 1) =>
        send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });
    const shot = async (name) => {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        if (r.result?.data) fs.writeFileSync(`${__dirname}/shot-${name}.png`, Buffer.from(r.result.data, 'base64'));
    };

    const which = process.argv[2] || '搜索歌词';
    const wait = +(process.argv[3] || 6000);

    const hit = await evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('.music-detail--container .lyric-item.search-lyric'));
        const el = btns.find(e => (e.innerText||'').trim() === ${JSON.stringify(which)});
        if (!el) return { error: 'button not found', all: btns.map(e => (e.innerText||'').trim()) };
        const r = el.getBoundingClientRect();
        return { text: (el.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (hit.value?.error) { console.log('❌ ' + hit.value.error + ' ' + JSON.stringify(hit.value.all)); ws.close(); return; }
    console.log('点击: ' + hit.value.text);
    await mouse('mouseMoved', hit.value.x, hit.value.y, 'none', 0);
    await mouse('mousePressed', hit.value.x, hit.value.y, 'left', 1);
    await mouse('mouseReleased', hit.value.x, hit.value.y, 'left', 0);
    await sleep(wait);
    await shot(which === '搜索歌词' ? 'search-lyric' : 'smart-lyric');

    const modal = await evaluate(`(() => {
        const dump = (sel) => {
            const m = document.querySelector(sel);
            if (!m) return null;
            return {
                input: m.querySelector('input')?.value ?? null,
                tabs: Array.from(m.querySelectorAll('.tab-list-item')).map(e => (e.innerText||'').trim()),
                panels: Array.from(m.querySelectorAll('.tab-panel-container')).map(p => ({
                    visible: p.getBoundingClientRect().height > 0,
                    count: p.querySelectorAll('.lyric-item').length,
                    items: Array.from(p.querySelectorAll('.lyric-item')).map(e => ({
                        title: (e.querySelector('.title')?.innerText||'').trim(),
                        artist: (e.querySelector('.artist')?.innerText||'').trim(),
                    })).slice(0, 6),
                })),
            };
        };
        return {
            searchLyric: dump('.modal--search-lyric-container'),
            smartLyric: dump('.modal--smart-lyric-container'),
            allModals: Array.from(document.querySelectorAll('[class*="modal--"]')).map(e => e.className),
        };
    })()`);
    console.log(JSON.stringify(modal.value, null, 2));
    ws.close();
})();
