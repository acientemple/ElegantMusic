// 单击列表行 → 看详情面板是否出现
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

  const loc = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => {
      const td = t.querySelectorAll('td');
      return (td[2]?.innerText || '').trim() && (td[3]?.innerText || '').trim();
    });
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td');
    const r = td[2].getBoundingClientRect();
    return { title: (td[2].innerText||'').trim(), artist: (td[3].innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  if (loc.error || loc.value?.error) { console.log('❌ ' + (loc.error || loc.value.error)); ws.close(); return; }
  const p = loc.value;
  console.log(`单击: ${p.title} — ${p.artist}`);

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1500);

  const st = await evaluate(`(() => ({
    url: location.hash,
    detail: !!document.querySelector('.music-detail--container'),
    lyricItems: Array.from(document.querySelectorAll('.music-detail--container .lyric-item')).map(e => (e.innerText||'').trim()).slice(0, 10),
    lyricBox: (() => {
      const el = document.querySelector('.music-detail--container .lyric-container') || document.querySelector('.music-detail--container [class*="lyric"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  }))()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
