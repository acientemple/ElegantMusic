// 一气呵成：暂停播放 → 打开详情 → 右键歌词 → 搜索歌词 → 切「歌词聚合」tab → 抓结果
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

  // 1. 暂停播放
  await evaluate(`(() => {
    const b = document.querySelector('[class*="play-state"], [class*="play-button"], [class*="play-ctrl"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(500);

  // 2. 打开详情（没开就点歌名）
  for (let i = 0; i < 3; i++) {
    const ok = await evaluate(`(() => !!document.querySelector('.music-detail--container'))()`);
    if (ok.value) break;
    await evaluate(`(() => { const t = document.querySelector('.music-title span[role="button"]'); if (t) t.click(); return true; })()`);
    await sleep(1200);
  }
  const opened = await evaluate(`(() => !!document.querySelector('.music-detail--container'))()`);
  console.log('详情已打开:', opened.value);
  if (!opened.value) { ws.close(); return; }

  // 3. 等歌词区出现
  const lyric = await evaluate(`(() => {
    const el = document.querySelector('.music-detail--container .lyric-container')
      || document.querySelector('.music-detail--container [class*="lyric"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  console.log('歌词区:', JSON.stringify(lyric.value));
  if (!lyric.value) { ws.close(); return; }

  // 4. 右键（先真实右键，不行就派发 contextmenu）
  await mouse('mouseMoved', lyric.value.x, lyric.value.y, 'none', 0);
  await sleep(120);
  await mouse('mousePressed', lyric.value.x, lyric.value.y, 'right', 2);
  await sleep(150);
  await mouse('mouseReleased', lyric.value.x, lyric.value.y, 'right', 0);
  await sleep(800);
  const hasMenu = await evaluate(`(() => !!Array.from(document.querySelectorAll('div,span')).find(e => String(e.className).includes('lyric-ctx-menu')))()`);
  if (!hasMenu.value) {
    await evaluate(`(() => {
      const el = document.querySelector('.music-detail--container .lyric-container')
        || document.querySelector('.music-detail--container [class*="lyric"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: r.x + r.width/2, clientY: r.y + r.height/2 }));
      return true;
    })()`);
    await sleep(900);
  }

  // 5. 点「搜索歌词」
  const menu = await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('div,span,li'));
    const c = all.filter(e => {
      const t = (e.innerText||'').trim();
      if (t !== '搜索歌词' || t.length > 12) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && String(e.className).includes('ctx-menu');
    });
    if (!c.length) return { error: 'no menu', all: all.filter(e => (e.innerText||'').trim().includes('歌词')).map(e => (e.innerText||'').trim().slice(0,20)).slice(0,10) };
    const r = c[0].getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  console.log('菜单项:', JSON.stringify(menu.value || menu));
  if (!menu.value || menu.value.error) { ws.close(); return; }
  await mouse('mouseMoved', menu.value.x, menu.value.y, 'none', 0);
  await sleep(120);
  await mouse('mousePressed', menu.value.x, menu.value.y, 'left', 1);
  await sleep(60);
  await mouse('mouseReleased', menu.value.x, menu.value.y, 'left', 0);
  await sleep(600);
  // 菜单项可能没被点中，退回 JS click
  await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('div,span,li'));
    const c = all.find(e => {
      const t = (e.innerText||'').trim();
      if (t !== '搜索歌词' || t.length > 12) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && String(e.className).includes('ctx-menu');
    });
    if (c) c.click();
    return !!c;
  })()`);
  await sleep(2500);

  // 6. 切「歌词聚合」tab
  const tab = await evaluate(`(() => {
    const t = Array.from(document.querySelectorAll('.tab-list-item')).find(e => (e.innerText||'').trim() === '歌词聚合');
    if (!t) return { error: 'no tab', tabs: Array.from(document.querySelectorAll('.tab-list-item')).map(e => (e.innerText||'').trim()) };
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  console.log('tab:', JSON.stringify(tab.value || tab));
  if (!tab.value || tab.value.error) { ws.close(); return; }
  await mouse('mouseMoved', tab.value.x, tab.value.y, 'none', 0);
  await sleep(120);
  await mouse('mousePressed', tab.value.x, tab.value.y, 'left', 1);
  await mouse('mouseReleased', tab.value.x, tab.value.y, 'left', 0);
  await sleep(4000);

  const res = await evaluate(`(() => {
    const modal = document.querySelector('.modal--search-lyric-container');
    if (!modal) return { error: 'no modal' };
    const panel = Array.from(modal.querySelectorAll('.tab-panel-container')).find(p => p.getBoundingClientRect().width > 0) || modal;
    const items = Array.from(panel.querySelectorAll('.lyric-item')).map(e => ({
      title: (e.querySelector('.title')?.innerText || '').trim(),
      artist: (e.querySelector('.artist')?.innerText || '').trim(),
    }));
    return { count: items.length, items: items.slice(0, 8) };
  })()`);
  console.log('歌词聚合结果:', JSON.stringify(res.value || res, null, 2));
  ws.close();
})();
