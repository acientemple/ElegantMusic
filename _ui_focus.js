// 聚焦顶部搜索框并插入文字，再点 search-submit
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

  const focused = await evaluate(`(() => {
    const el = document.querySelector('.header-search-input');
    if (!el) return { error: 'no input' };
    el.focus();
    el.click();
    return { active: document.activeElement === el, tag: document.activeElement.tagName };
  })()`);
  console.log('focus:', JSON.stringify(focused.value || focused));

  await sleep(200);
  await send('Input.insertText', { text: '青花瓷' });
  await sleep(600);
  const v = await evaluate(`(() => {
    const el = document.querySelector('.header-search-input');
    return { value: el.value, active: document.activeElement === el };
  })()`);
  console.log('after insertText:', JSON.stringify(v.value));

  // 点搜索按钮
  const btn = await evaluate(`(() => {
    const b = document.querySelector('.search-submit');
    if (!b) return { error: 'no btn' };
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  console.log('btn:', JSON.stringify(btn.value || btn));
  if (btn.value && !btn.value.error) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.value.x, y: btn.value.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.value.x, y: btn.value.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(3000);
  }
  const st = await evaluate(`(() => ({
    url: location.hash,
    rows: Array.from(document.querySelectorAll('.music-list-container tbody tr')).slice(0, 6).map(t => {
      const td = t.querySelectorAll('td');
      return [ (td[2]?.innerText||'').trim(), (td[3]?.innerText||'').trim() ];
    }),
  }))()`);
  console.log('state:', JSON.stringify(st.value, null, 2));
  ws.close();
})();
