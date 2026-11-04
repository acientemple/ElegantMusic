// 滚动列表到顶部 → 点第一行 → 打开详情
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

  const scroll = await evaluate(`(() => {
    const cands = Array.from(document.querySelectorAll('*')).filter(e => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 200);
    const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!el) return { error: 'no scroll container' };
    el.scrollTop = 0;
    return { cls: String(el.className).slice(0, 60), top: el.scrollTop };
  })()`);
  console.log('scroll:', JSON.stringify(scroll.value || scroll));
  await sleep(1200);

  const click = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => {
      const td = t.querySelectorAll('td');
      return (td[2]?.innerText || '').includes('Because You Loved Me');
    }) || trs[0];
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td');
    const title = (td[2]?.innerText || '').trim();
    const artist = (td[3]?.innerText || '').trim();
    const r = td[2].getBoundingClientRect();
    return { title, artist, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  console.log('click:', JSON.stringify(click.value || click));
  const c = click.value;
  if (c && !c.error) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(2500);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      top: detail ? (detail.innerText||'').slice(0,240) : null,
    };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
