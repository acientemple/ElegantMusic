// 选中一个不被吸顶表头遮挡的行 → 右键 → 点「搜索完整播放版本」→ 读弹窗
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
    const mouse = async (type, x, y, button, buttons) =>
        send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });

    // 关掉可能已开的弹窗/菜单
    await evaluate(`(() => {
        const b = document.querySelector('.modal--music-alternatives-container .btn-icon, .modal--music-alternatives-container button');
        if (b) b.click();
        document.body.click();
        return true;
    })()`);
    await sleep(500);

    const loc = await evaluate(`(() => {
        const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
        for (const tr of trs) {
            const td = tr.querySelectorAll('td');
            const cell = td[2];
            const title = (cell?.innerText || '').trim();
            const artist = (td[3]?.innerText || '').trim();
            if (!title || !artist || title.length > 60) continue;
            const r = cell.getBoundingClientRect();
            const x = r.x + r.width/2, y = r.y + r.height/2;
            if (y < 140 || y > innerHeight - 120) continue;      // 避开吸顶表头和底栏
            const hit = document.elementFromPoint(x, y);
            if (!hit || !cell.contains(hit)) continue;          // 命中点必须落在标题格里
            return {
                title, artist,
                duration: (td[5]?.innerText||'').trim(),
                platform: (td[6]?.innerText||'').trim(),
                x, y,
            };
        }
        return { error: '找不到可点击的行' };
    })()`);
    if (loc.error || loc.value?.error) { console.log('❌ ' + (loc.error || loc.value.error)); ws.close(); return; }
    const p = loc.value;
    console.log(`目标: ${p.title} — ${p.artist} (${p.duration}, ${p.platform}) @ (${Math.round(p.x)}, ${Math.round(p.y)})`);

    await mouse('mouseMoved', p.x, p.y, 'none', 0);
    await mouse('mousePressed', p.x, p.y, 'right', 2);
    await sleep(150);
    await mouse('mouseReleased', p.x, p.y, 'right', 0);
    await sleep(1200);

    const menu = await evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.context-menu--single-column-container .menu-item'))
            .map(m => ({ text: (m.innerText||'').trim(), el: m }));
        const target = items.find(i => i.text.includes('完整播放'));
        if (!target) return { found: 0, all: items.map(i => i.text) };
        const r = target.el.getBoundingClientRect();
        return { found: 1, all: items.map(i => i.text), x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (!menu.value.found) { console.log('❌ 菜单未展开: ' + JSON.stringify(menu.value.all)); ws.close(); return; }
    console.log('✓ 右键菜单: ' + JSON.stringify(menu.value.all));
    console.log('✓ 点击「搜索完整播放版本」');

    await mouse('mousePressed', menu.value.x, menu.value.y, 'left', 1);
    await mouse('mouseReleased', menu.value.x, menu.value.y, 'left', 0);
    await sleep(9000);

    const out = await evaluate(`(() => {
        const m = document.querySelector('.modal--music-alternatives-container');
        if (!m) return { modalFound: false };
        const items = Array.from(m.querySelectorAll('.alternative-item'));
        return {
            modalFound: true,
            subtitle: m.querySelector('.alternatives-subtitle')?.innerText || '',
            count: items.length,
            originCount: items.filter(i => i.querySelector('.origin-tag')).length,
            fullCount: items.filter(i => i.querySelector('.full-tag')).length,
            rows: items.slice(0, 6).map(i => ({
                title: i.querySelector('.title')?.innerText || '',
                artist: i.querySelector('.artist')?.innerText || '',
                origin: !!i.querySelector('.origin-tag'),
                duration: i.querySelector('.duration')?.innerText || '',
                hasImg: !!i.querySelector('img')?.getAttribute('src'),
            })),
        };
    })()`);
    console.log(JSON.stringify(out.value, null, 2));
    ws.close();
})();
