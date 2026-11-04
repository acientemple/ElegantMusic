// 用 element.click() 触发 React onClick 打开详情
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

  const click = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => {
      const td = t.querySelectorAll('td');
      return (td[2]?.innerText || '').includes('Because You Loved Me');
    });
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td');
    td[2].click();
    return { title: (td[2].innerText||'').trim() };
  })()`);
  console.log('click:', JSON.stringify(click.value || click));
  await sleep(2500);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      lyrics: Array.from(detail?.querySelectorAll('.lyric-item') || []).map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,6),
      top: detail ? (detail.innerText||'').slice(0,200) : null,
    };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
