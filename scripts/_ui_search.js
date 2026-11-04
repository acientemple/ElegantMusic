// 在应用顶部搜索框搜「青花瓷」，列出结果
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
  const mouse = async (type, x, y, button, buttons, clickCount = 1) =>
    send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });

  // 1. 点顶部搜索框
  const box = await evaluate(`(() => {
    const el = document.querySelector('.header-search-input');
    if (!el) return { error: 'no input' };
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (box.error || box.value?.error) { console.log('❌ ' + (box.error || box.value.error)); ws.close(); return; }
  const b = box.value;
  await mouse('mousePressed', b.x, b.y, 'left', 1);
  await mouse('mouseReleased', b.x, b.y, 'left', 0);
  await sleep(300);

  // 2. 清空 + 输入
  await evaluate(`(() => {
    const el = document.querySelector('.header-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  await send('Input.insertText', { text: '青花瓷' });
  await sleep(1200);

  // 3. 回车
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(2500);

  const rows = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    return {
      url: location.hash,
      count: trs.length,
      rows: trs.slice(0, 8).map(t => {
        const td = t.querySelectorAll('td');
        const cell = (i) => (td[i]?.innerText || '').trim();
        const r = td[2]?.getBoundingClientRect();
        return { title: cell(2), artist: cell(3), x: r ? Math.round(r.x + r.width / 2) : 0, y: r ? Math.round(r.y + r.height / 2) : 0 };
      }),
    };
  })()`);
  console.log(JSON.stringify(rows.value || rows, null, 2));
  ws.close();
})();
