// 顶部搜索框输入后按回车，跳转搜索页
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

  for (const type of ['rawKeyDown', 'char', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: type === 'char' ? '\r' : undefined,
    });
    await sleep(120);
  }
  await sleep(3500);

  const st = await evaluate(`(() => ({
    url: location.hash,
    title: document.title,
    tabs: Array.from(document.querySelectorAll('[class*="tab"]')).map(e => (e.innerText||'').trim()).filter(Boolean).slice(0, 20),
    rows: Array.from(document.querySelectorAll('.music-list-container tbody tr')).slice(0, 8).map(t => {
      const td = t.querySelectorAll('td');
      return [ (td[2]?.innerText||'').trim(), (td[3]?.innerText||'').trim(), (td[6]?.innerText||'').trim() ];
    }),
  }))()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
