// 依次尝试各种入口打开详情面板
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

  const targets = [
    '.music-title span[role="button"]',
    '.music-info-outer-container .open-detail',
    '.music-bar--container .open-detail',
    '.music-info-container .open-detail',
    '.music-info-container .music-title',
  ];
  for (const sel of targets) {
    const r = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { sel: ${JSON.stringify(sel)}, found: false };
      el.click();
      return { sel: ${JSON.stringify(sel)}, found: true };
    })()`);
    await sleep(1200);
    const st = await evaluate(`(() => ({
      detail: !!document.querySelector('.music-detail--container'),
      anyDetail: Array.from(new Set(Array.from(document.querySelectorAll('div')).map(e => String(e.className)).filter(c => /detail/i.test(c)))).slice(0,6),
    }))()`);
    console.log(JSON.stringify(r.value || r), '->', JSON.stringify(st.value || st));
    if ((st.value || st).detail) { console.log('✅ 详情已打开'); break; }
  }
  ws.close();
})();
