// JS 派发 click 到 .music-title span → 打开详情面板
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

  const r1 = await evaluate(`(() => {
    const t = document.querySelector('.music-title span[role="button"]');
    if (!t) return { error: 'no title span', html: (document.querySelector('.music-info')||{}).outerHTML?.slice(0,400) };
    const title = (t.innerText||'').trim();
    t.click();
    return { title };
  })()`);
  console.log('点击歌名:', JSON.stringify(r1.value || r1));
  await sleep(3000);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      top: detail ? (detail.innerText||'').slice(0,240) : null,
      lyrics: Array.from(detail?.querySelectorAll('.lyric-item') || []).map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,8),
    };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
