// 关掉残留的右键菜单 → 滚动到顶 → 点击第一行打开详情
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

  // 关菜单：点页面空白处 + Escape
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
  const cleared = await evaluate(`(() => {
    const menus = Array.from(document.querySelectorAll('.context-menu--single-column-container'));
    const before = menus.length;
    menus.forEach(m => m.remove());
    return { before, after: document.querySelectorAll('.context-menu--single-column-container').length };
  })()`);
  console.log('菜单:', JSON.stringify(cleared.value || cleared));
  await sleep(500);

  // 滚动到顶
  await evaluate(`(() => {
    const cands = Array.from(document.querySelectorAll('*')).filter(e => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 200);
    const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) { el.scrollTop = 0; el.dispatchEvent(new Event('scroll', {bubbles:true})); }
    return true;
  })()`);
  await sleep(1200);

  const click = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => {
      const td = t.querySelectorAll('td');
      return (td[2]?.innerText || '').includes('Because You Loved Me');
    }) || trs[0];
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td');
    const r = td[2].getBoundingClientRect();
    return { title: (td[2].innerText||'').trim(), artist: (td[3].innerText||'').trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  console.log('目标:', JSON.stringify(click.value || click));
  const c = click.value;
  if (c && !c.error) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
    await sleep(150);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(3000);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      top: detail ? (detail.innerText||'').slice(0,260) : null,
      menus: document.querySelectorAll('.context-menu--single-column-container').length,
    };
  })()`);
  console.log(JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
