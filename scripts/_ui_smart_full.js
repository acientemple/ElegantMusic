// 右键歌词 → 智能匹配歌词 → 抓候选 → 点第一个 → 检查歌词切换
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

  // 确保详情面板打开
  for (let i = 0; i < 4; i++) {
    const ok = await evaluate(`(() => !!document.querySelector('.music-detail--container'))()`);
    if (ok.value) break;
    await evaluate(`(() => { const t = document.querySelector('.music-title span[role="button"]'); if (t) t.click(); return true; })()`);
    await sleep(1200);
  }
  const lyric = await evaluate(`(() => {
    const el = document.querySelector('.music-detail--container .lyric-container')
      || document.querySelector('.music-detail--container [class*="lyric"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  if (!lyric.value) { console.log('❌ 没有歌词区'); ws.close(); return; }

  // 关掉可能残留的搜索弹窗（用 Escape，不要直接删 DOM，会破坏 React 状态）
  const hasModal = await evaluate(`(() => !!document.querySelector('.modal--search-lyric-container'))()`);
  if (hasModal.value) {
    await evaluate(`(() => { const b = document.querySelector('.components--modal-base-header-close'); if (b) b.click(); return true; })()`);
    await sleep(800);
  }

  // 右键：先真实右键，不行再派发 contextmenu
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lyric.value.x, y: lyric.value.y, button: 'none', buttons: 0 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: lyric.value.x, y: lyric.value.y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lyric.value.x, y: lyric.value.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(900);
  const hasMenu = await evaluate(`(() => !!Array.from(document.querySelectorAll('div,span')).find(e => String(e.className).includes('lyric-ctx-menu')))()`);
  if (!hasMenu.value) {
    await evaluate(`(() => {
      const el = document.querySelector('.music-detail--container .lyric-container')
        || document.querySelector('.music-detail--container [class*="lyric"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: r.x + r.width/2, clientY: r.y + r.height/2 }));
      return true;
    })()`);
    await sleep(900);
  }

  const menu = await evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('div,span,li'));
    const c = all.find(e => {
      const t = (e.innerText||'').trim();
      if (t !== '智能匹配歌词' || t.length > 12) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && String(e.className).includes('ctx-menu');
    });
    if (!c) return { error: 'no menu' };
    c.click();
    return { clicked: true };
  })()`);
  console.log('点击智能匹配:', JSON.stringify(menu.value || menu));

  // 等候选
  let cand = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const r = await evaluate(`(() => {
      const modal = document.querySelector('.modal--smart-lyric-container');
      if (!modal) return { loading: true };
      const items = Array.from(modal.querySelectorAll('.candidate-item'));
      if (!items.length) return { loading: true, text: (modal.innerText||'').slice(0,120) };
      return {
        count: items.length,
        top: items.slice(0, 6).map(e => ({
          txt: (e.innerText||'').trim().replace(/\\n/g, ' | ').slice(0, 110),
        })),
      };
    })()`);
    if (r.value && r.value.count) { cand = r.value; break; }
  }
  console.log('候选:', JSON.stringify(cand, null, 2));
  if (!cand) { ws.close(); return; }

  // 点第一个候选
  await evaluate(`(() => {
    const c = document.querySelector('.modal--smart-lyric-container .candidate-item');
    if (c) c.click();
    return true;
  })()`);
  await sleep(4000);

  const after = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    const items = Array.from(detail?.querySelectorAll('.lyric-item') || []).map(e => (e.innerText||'').trim()).filter(Boolean);
    return {
      modalOpen: !!document.querySelector('.modal--smart-lyric-container'),
      lyricCount: items.length,
      lyricHead: items.slice(0, 8),
      top: detail ? (detail.innerText||'').slice(0, 160) : null,
    };
  })()`);
  console.log('关联后:', JSON.stringify(after.value || after, null, 2));
  ws.close();
})();
