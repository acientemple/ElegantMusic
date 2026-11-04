// 右键歌词区 → 点「搜索歌词」→ 抓取弹窗状态
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

  const box = await evaluate(`(() => {
    const el = document.querySelector('.music-detail--container .lyric-container')
      || document.querySelector('.music-detail--container [class*="lyric"]');
    if (!el) return { error: 'no lyric container' };
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (box.error || box.value?.error) { console.log('❌ ' + (box.error || box.value.error)); ws.close(); return; }
  const b = box.value;
  await mouse('mouseMoved', b.x, b.y, 'none', 0);
  await mouse('mousePressed', b.x, b.y, 'right', 2);
  await sleep(150);
  await mouse('mouseReleased', b.x, b.y, 'right', 0);
  await sleep(900);

  const menu = await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('div,span,li'));
    const cand = all.filter(e => {
      const t = (e.innerText || '').trim();
      if (!t || t.length > 12) return false;
      if (!/搜索歌词|智能匹配/.test(t)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return cand.map(e => {
      const r = e.getBoundingClientRect();
      return { txt: (e.innerText || '').trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), cls: String(e.className).slice(0,50) };
    });
  })()`);
  console.log('右键菜单:', JSON.stringify(menu.value || menu));
  const item = (menu.value || []).find(m => /搜索歌词/.test(m.txt));
  if (!item) { console.log('❌ 菜单里没有「搜索歌词」'); ws.close(); return; }

  await mouse('mouseMoved', item.x, item.y, 'none', 0);
  await mouse('mousePressed', item.x, item.y, 'left', 1);
  await mouse('mouseReleased', item.x, item.y, 'left', 0);
  await sleep(2500);

  const modal = await evaluate(`(() => ({
    modals: Array.from(document.querySelectorAll('[class*="modal"]')).map(e => String(e.className)).slice(0, 8),
    bodyText: (document.body.innerText || '').slice(0, 1200),
    inputs: Array.from(document.querySelectorAll('input')).map(e => ({
      cls: e.className, ph: e.placeholder, value: e.value,
      rect: (() => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })(),
    })),
  }))()`);
  console.log('弹窗:', JSON.stringify(modal.value || modal, null, 2));
  ws.close();
})();
