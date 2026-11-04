// 点底栏歌名 → 详情面板 → 右键歌词 → 搜索歌词 → 切到歌词聚合 tab
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

  // 1. 点底栏歌名
  const info = await evaluate(`(() => {
    const e = document.querySelector('.music-info-container') || document.querySelector('.music-info');
    if (!e) return { error: 'no music info' };
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), txt: (e.innerText||'').trim().slice(0,60) };
  })()`);
  if (info.error || info.value?.error) { console.log('❌ ' + (info.error || info.value.error)); ws.close(); return; }
  console.log('底栏:', info.value.txt);
  await mouse('mouseMoved', info.value.x, info.value.y, 'none', 0);
  await sleep(150);
  await mouse('mousePressed', info.value.x, info.value.y, 'left', 1);
  await mouse('mouseReleased', info.value.x, info.value.y, 'left', 0);
  await sleep(3000);

  const st = await evaluate(`(() => {
    const detail = document.querySelector('.music-detail--container');
    return {
      detail: !!detail,
      top: detail ? (detail.innerText||'').slice(0,200) : null,
      lyricItems: Array.from(detail?.querySelectorAll('.lyric-item') || []).map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,6),
    };
  })()`);
  console.log('详情:', JSON.stringify(st.value || st, null, 2));
  ws.close();
})();
