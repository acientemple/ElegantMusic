// 双击某一行播放，然后打开 MusicDetail 面板
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
    const mouse = async (type, x, y, button, buttons, clickCount) =>
        send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });

    const want = process.argv[2] || '';
    const loc = await evaluate(`(() => {
        const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
        for (const tr of trs) {
            const td = tr.querySelectorAll('td');
            const title = (td[2]?.innerText || '').trim();
            const artist = (td[3]?.innerText || '').trim();
            if (!title || !artist) continue;
            if (${JSON.stringify(want)} && !title.includes(${JSON.stringify(want)})) continue;
            const r = td[2].getBoundingClientRect();
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            if (y < 140 || y > innerHeight - 120) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !td[2].contains(hit)) continue;
            return { title, artist, x, y };
        }
        return { error: 'no row' };
    })()`);
    if (loc.error || loc.value?.error) { console.log('❌ ' + (loc.error || loc.value.error)); ws.close(); return; }
    const p = loc.value;
    console.log(`▶ 双击: ${p.title} — ${p.artist}`);

    await mouse('mouseMoved', p.x, p.y, 'none', 0, 1);
    await mouse('mousePressed', p.x, p.y, 'left', 1, 1);
    await mouse('mouseReleased', p.x, p.y, 'left', 0, 1);
    await sleep(80);
    await mouse('mousePressed', p.x, p.y, 'left', 1, 2);
    await mouse('mouseReleased', p.x, p.y, 'left', 0, 2);
    await sleep(2500);

    const st = await evaluate(`(() => {
        const qa = (s) => Array.from(document.querySelectorAll(s));
        return {
            nowPlaying: qa('.music-bar--container .music-title span').map(e => (e.innerText||'').trim()),
            hasOpenDetail: !!document.querySelector('.open-detail'),
        };
    })()`);
    console.log('播放状态: ' + JSON.stringify(st.value));

    // 打开 MusicDetail
    const d = await evaluate(`(() => {
        const el = document.querySelector('.open-detail');
        if (!el) return { error: 'no .open-detail' };
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (d.error || d.value?.error) { console.log('❌ ' + (d.error || d.value.error)); ws.close(); return; }
    await mouse('mouseMoved', d.value.x, d.value.y, 'none', 0, 1);
    await mouse('mousePressed', d.value.x, d.value.y, 'left', 1, 1);
    await mouse('mouseReleased', d.value.x, d.value.y, 'left', 0, 1);
    await sleep(1200);

    const det = await evaluate(`(() => {
        const c = document.querySelector('.music-detail--container');
        if (!c) return { found: false };
        return {
            found: true,
            title: (c.querySelector('.music-detail--title, [class*="title"]')?.innerText || '').trim(),
            lyricItems: Array.from(c.querySelectorAll('.lyric-item')).map(e => (e.innerText||'').trim()).slice(0, 10),
            searchLyricBtns: Array.from(c.querySelectorAll('.lyric-item.search-lyric')).map(e => (e.innerText||'').trim()),
        };
    })()`);
    console.log('MusicDetail: ' + JSON.stringify(det.value, null, 2));
    ws.close();
})();
