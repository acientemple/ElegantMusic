// 诊断：详情打开后右键，菜单是否出现
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

  for (let i = 0; i < 4; i++) {
    const ok = await evaluate(`(() => !!document.querySelector('.music-detail--container'))()`);
    if (ok.value) break;
    await evaluate(`(() => { const t = document.querySelector('.music-title span[role="button"]'); if (t) t.click(); return true; })()`);
    await sleep(1200);
  }
  const detail = await evaluate(`(() => {
    const d = document.querySelector('.music-detail--container');
    if (!d) return { open: false };
    const el = d.querySelector('.lyric-container') || d.querySelector('[class*="lyric"]');
    if (!el) return { open: true, noLyric: true, classes: Array.from(new Set(Array.from(d.querySelectorAll('div')).map(e => String(e.className)))).slice(0,15) };
    const r = el.getBoundingClientRect();
    return { open: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), cls: String(el.className).slice(0,50) };
  })()`);
  console.log('详情:', JSON.stringify(detail.value || detail));
  if (!detail.value || detail.value.x === undefined) { ws.close(); return; }

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: detail.value.x, y: detail.value.y, button: 'none', buttons: 0 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: detail.value.x, y: detail.value.y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: detail.value.x, y: detail.value.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(1000);

  const menu = await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('div,span,li'));
    const menus = all.filter(e => /menu|ctx/i.test(String(e.className)));
    return {
      menuClasses: Array.from(new Set(menus.map(e => String(e.className).slice(0,60)))).slice(0, 12),
      texts: menus.map(e => (e.innerText||'').trim()).filter(t => t && t.length < 20).slice(0, 12),
    };
  })()`);
  console.log('菜单:', JSON.stringify(menu.value || menu, null, 2));
  ws.close();
})();
