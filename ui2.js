// 用 CDP 真实鼠标事件模拟右键 → 点「搜索完整播放版本」→ 读取弹窗
const fs = require('fs');

(async () => {
    const list = await (await fetch('http://localhost:9222/json')).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener('open', res);
        ws.addEventListener('error', rej);
    });
    const send = (method, params) =>
        new Promise((resolve) => {
            const msgId = ++id;
            pending.set(msgId, resolve);
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (r.result?.exceptionDetails) {
            return {
                error:
                    r.result.exceptionDetails.exception?.description ||
                    r.result.exceptionDetails.text,
            };
        }
        return { value: r.result?.result?.value };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 0. 关掉可能已打开的弹窗
    await evaluate(`(() => {
        const btn = document.querySelector('.modal--music-alternatives-container .btn-icon, .modal--music-alternatives-container button');
        if (btn) { btn.click(); return 'closed'; }
        return 'none';
    })()`);
    await sleep(800);

    // 1. 定位歌曲行，取标题单元格的屏幕坐标
    const loc = await evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('.music-list-container tbody tr'))
            .filter(tr => tr.querySelectorAll('td').length > 3);
        if (!rows.length) return { error: '找不到音乐行' };
        const row = rows[0];
        const tds = row.querySelectorAll('td');
        const info = {
            cellCount: tds.length,
            cells: Array.from(tds).map(td => (td.innerText || '').trim().slice(0, 30)),
        };
        const cell = tds[2];
        const r = cell.getBoundingClientRect();
        info.title = (cell.innerText || '').trim();
        info.artist = (tds[3]?.innerText || '').trim();
        info.x = r.x + r.width / 2;
        info.y = r.y + r.height / 2;
        info.top = window.innerHeight;
        return info;
    })()`);
    if (loc.error) {
        console.log('❌ ' + loc.error);
        ws.close();
        return;
    }
    const info = loc.value;
    console.log('行信息: ' + JSON.stringify(info.cells));
    console.log('目标歌曲: ' + info.title + ' - ' + info.artist);

    // 2. 真实右键
    await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: info.x,
        y: info.y,
        button: 'right',
        buttons: 2,
        clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: info.x,
        y: info.y,
        button: 'right',
        buttons: 0,
        clickCount: 1,
    });
    await sleep(1200);

    // 3. 找到菜单项并真实点击
    const menu = await evaluate(`(() => {
        const all = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.textContent || '').trim();
            return t === '搜索完整播放版本' && el.children.length === 0;
        });
        if (!all.length) {
            const cands = Array.from(document.querySelectorAll('body *'))
                .filter(el => (el.innerText || '').includes('完整播放'))
                .slice(-6)
                .map(el => el.tagName + '.' + el.className + ' :: ' + (el.innerText||'').replace(/\\n/g,' | ').slice(0,120));
            return { found: 0, cands };
        }
        const el = all[0];
        const r = el.getBoundingClientRect();
        return { found: all.length, x: r.x + r.width/2, y: r.y + r.height/2, text: (el.innerText||'').trim() };
    })()`);
    if (!menu.value.found) {
        console.log('菜单项数量=0');
        console.log(JSON.stringify(menu.value.cands, null, 2));
        ws.close();
        return;
    }
    console.log('菜单项数量=' + menu.value.found + ' 「' + menu.value.text + '」');

    await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: menu.value.x,
        y: menu.value.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: menu.value.x,
        y: menu.value.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
    });
    await sleep(6000);

    // 4. 读取弹窗
    const out = await evaluate(`(() => {
        const modal = document.querySelector('.modal--music-alternatives-container');
        if (!modal) {
            const anyModal = Array.from(document.querySelectorAll('[class*="modal"]'))
                .map(el => el.className).slice(0, 8);
            return { modalFound: false, anyModal };
        }
        const items = Array.from(modal.querySelectorAll('.alternative-item'));
        return {
            modalFound: true,
            subtitle: modal.querySelector('.alternatives-subtitle')?.innerText || '',
            count: items.length,
            rows: items.slice(0, 10).map(el => ({
                title: el.querySelector('.title')?.innerText || '',
                artist: el.querySelector('.artist')?.innerText || '',
                tags: Array.from(el.querySelectorAll('span')).map(x => x.innerText).filter(Boolean).slice(0, 4),
                duration: el.querySelector('.duration')?.innerText || '',
                img: (el.querySelector('img')?.getAttribute('src') || '').slice(0, 60),
            })),
        };
    })()`);
    console.log(JSON.stringify(out.value, null, 2));
    ws.close();
})();
