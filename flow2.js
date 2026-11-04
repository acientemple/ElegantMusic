// 播放 → 暂停 → 打开 MusicDetail → 点「搜索歌词」→ 抓弹窗
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
    const clickAt = async (x, y) => {
        await mouse('mouseMoved', x, y, 'none', 0);
        await mouse('mousePressed', x, y, 'left', 1);
        await mouse('mouseReleased', x, y, 'left', 0);
    };

    // 1. 暂停当前播放，避免歌曲自动轮播
    await evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('[role="button"],button'));
        const pause = btns.find(e => /pause|暂停/i.test(e.getAttribute('title') || e.getAttribute('aria-label') || ''));
        if (pause) { pause.click(); return 'paused'; }
        return 'no pause btn';
    })()`);
    await sleep(500);

    // 2. 打开 MusicDetail（若未打开）
    const open = await evaluate(`(() => {
        if (document.querySelector('.music-detail--container')) return 'already';
        const el = document.querySelector('.open-detail');
        if (!el) return { error: 'no .open-detail' };
        el.click();
        return 'opened';
    })()`);
    console.log('MusicDetail: ' + JSON.stringify(open.value));
    await sleep(1200);

    const cur = await evaluate(`(() => ({
        detailTitle: (document.querySelector('.music-detail--container .music-title')?.innerText || '').trim(),
        barTitle: (document.querySelector('.music-info .music-title span')?.innerText || '').trim(),
        btns: Array.from(document.querySelectorAll('.music-detail--container .lyric-item.search-lyric')).map(e => (e.innerText||'').trim()),
    }))()`);
    console.log('当前: ' + JSON.stringify(cur.value));

    // 3. 点按钮
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
    await sleep(+(process.argv[3] || 8000));
    await shot('modal');

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
                smart: Array.from(m.querySelectorAll('[class*="candidate"]')).map(e => (e.innerText||'').trim().replace(/\\n/g,' / ').slice(0,90)).slice(0,6),
            };
        };
        return {
            searchLyric: dump('.modal--search-lyric-container'),
            smartLyric: dump('.modal--smart-lyric-container'),
            allModals: Array.from(document.querySelectorAll('[class*="modal"]')).map(e => e.className).slice(0,10),
        };
    })()`);
    console.log(JSON.stringify(modal.value, null, 2));
    ws.close();
})();
