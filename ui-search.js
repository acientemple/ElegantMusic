// 应用内搜索 → 定位结果行 → 右键 → 点「搜索完整播放版本」→ 读弹窗
const fs = require('fs');

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

    // 1. 聚焦搜索框并清空（受控组件，不清空会拼词）
    const box = await evaluate(`(() => {
        const el = document.querySelector('.header-search-input');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        el.focus();
        el.setSelectionRange(0, (el.value || '').length);
        return { x: r.x + r.width/2, y: r.y + r.height/2, old: el.value };
    })()`);
    if (!box.value) { console.log('❌ 找不到搜索框'); ws.close(); return; }
    console.log('搜索框原值: ' + JSON.stringify(box.value.old));
    await mouse('mousePressed', box.value.x, box.value.y, 'left', 1);
    await mouse('mouseReleased', box.value.x, box.value.y, 'left', 0);
    await sleep(300);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(300);
    await send('Input.insertText', { text: '信仰 张信哲' });
    await sleep(500);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(5000);

    const rows = await evaluate(`(() => {
        const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
        return {
            hash: location.hash,
            total: trs.length,
            sample: trs.slice(0, 6).map(tr => {
                const td = tr.querySelectorAll('td');
                return Array.from(td).map(x => (x.innerText||'').trim().slice(0,24));
            }),
        };
    })()`);
    console.log('搜索结果页: ' + JSON.stringify(rows.value, null, 2));
    ws.close();
})();
