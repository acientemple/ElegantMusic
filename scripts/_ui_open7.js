// 用 JS 派发鼠标事件序列触发 React onClick（不受滚动/坐标影响）
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
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => (t.querySelectorAll('td')[2]?.innerText||'').includes('Because You Loved Me')) || trs[0];
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td')[2];
    const title = (td.innerText||'').trim();
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    td.dispatchEvent(new MouseEvent('mousedown', opts));
    td.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    td.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
    return { title };
  })()`);
  console.log('派发:', JSON.stringify(r1.value || r1));
  await sleep(3000);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return { detail: !!detail, top: detail ? (detail.innerText||'').slice(0,300) : null };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
