// 点「歌词聚合」tab，抓取结果
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

  const tab = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.tab-list-item'));
    const t = items.find(e => (e.innerText || '').trim() === '歌词聚合');
    if (!t) return { error: 'no tab', all: items.map(e => (e.innerText||'').trim()) };
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (tab.error || tab.value?.error) { console.log('❌ ' + (tab.error || JSON.stringify(tab.value))); ws.close(); return; }
  const t = tab.value;
  await mouse('mouseMoved', t.x, t.y, 'none', 0);
  await mouse('mousePressed', t.x, t.y, 'left', 1);
  await mouse('mouseReleased', t.x, t.y, 'left', 0);
  await sleep(4000);

  const res = await evaluate(`(() => {
    const modal = document.querySelector('.modal--search-lyric-container');
    const panels = Array.from(modal.querySelectorAll('.tab-panel-container'));
    const active = panels.find(p => {
      const cs = getComputedStyle(p);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && p.getBoundingClientRect().width > 0;
    }) || panels[0];
    const items = Array.from(active.querySelectorAll('.lyric-item')).map(e => ({
      title: (e.querySelector('.title')?.innerText || '').trim(),
      artist: (e.querySelector('.artist')?.innerText || '').trim(),
      text: (e.innerText || '').trim().replace(/\\n/g, ' | ').slice(0, 120),
    }));
    return { panelCount: panels.length, count: items.length, items: items.slice(0, 10) };
  })()`);
  console.log(JSON.stringify(res.value || res, null, 2));
  ws.close();
})();
