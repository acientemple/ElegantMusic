// 选一个当前可见（y 在视口内）的行并点击
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

  const pick = await evaluate(`(() => {
    const vh = window.innerHeight;
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const visible = trs.map(t => {
      const td = t.querySelectorAll('td');
      const r = td[2]?.getBoundingClientRect();
      return { t, td, r };
    }).filter(o => o.r && o.r.y > 300 && o.r.y + o.r.height < vh - 40 && o.r.width > 0);
    if (!visible.length) return { error: 'no visible row', vh, rows: trs.length };
    const o = visible[0];
    return {
      title: (o.td[2].innerText||'').trim(),
      artist: (o.td[3].innerText||'').trim(),
      x: Math.round(o.r.x + o.r.width/2),
      y: Math.round(o.r.y + o.r.height/2),
    };
  })()`);
  console.log('可见行:', JSON.stringify(pick.value || pick));
  const c = pick.value;
  if (!c || c.error) { ws.close(); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(3000);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      top: detail ? (detail.innerText||'').slice(0,300) : null,
    };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
