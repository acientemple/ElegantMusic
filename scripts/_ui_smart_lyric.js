// 关闭搜索歌词弹窗 → 右键歌词 → 智能匹配歌词 → 抓取结果
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

  // 1. 关弹窗
  const close = await evaluate(`(() => {
    const b = document.querySelector('.components--modal-base-header-close');
    if (!b) return { error: 'no close btn' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (close.value && !close.value.error) {
    await mouse('mousePressed', close.value.x, close.value.y, 'left', 1);
    await mouse('mouseReleased', close.value.x, close.value.y, 'left', 0);
    await sleep(800);
  }

  // 2. 右键歌词区
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
    return all.filter(e => {
      const t = (e.innerText || '').trim();
      if (!t || t.length > 12) return false;
      if (!/智能匹配/.test(t)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && String(e.className).includes('ctx-menu');
    }).map(e => { const r = e.getBoundingClientRect(); return { txt: (e.innerText||'').trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; });
  })()`);
  console.log('菜单:', JSON.stringify(menu.value || menu));
  const item = (menu.value || [])[0];
  if (!item) { console.log('❌ 没有「智能匹配歌词」菜单项'); ws.close(); return; }

  await mouse('mouseMoved', item.x, item.y, 'none', 0);
  await mouse('mousePressed', item.x, item.y, 'left', 1);
  await mouse('mouseReleased', item.x, item.y, 'left', 0);
  await sleep(6000);

  const res = await evaluate(`(() => {
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const detail = document.querySelector('.music-detail--container');
    return {
      newClasses: Array.from(new Set(qa('*').map(e => String(e.className)).filter(c => /smart|match|lyric/i.test(c) && c.length < 50))).slice(0, 20),
      detailText: detail ? (detail.innerText || '').slice(0, 900) : null,
      popups: qa('[class*="popover"],[class*="dropdown"],[class*="modal"],[class*="panel"]').map(e => String(e.className).slice(0, 60)).slice(0, 10),
    };
  })()`);
  console.log(JSON.stringify(res.value || res, null, 2));
  ws.close();
})();
