// 点第一个候选 → 检查歌词是否切换 + 关联信息
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

  const cand = await evaluate(`(() => {
    const c = document.querySelector('.modal--smart-lyric-container .candidate-item');
    if (!c) return { error: 'no candidate' };
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
      text: (c.innerText||'').trim().replace(/\\n/g,' | ').slice(0,140) };
  })()`);
  if (cand.error || cand.value?.error) { console.log('❌ ' + (cand.error || cand.value.error)); ws.close(); return; }
  console.log('点击候选:', cand.value.text);

  await mouse('mouseMoved', cand.value.x, cand.value.y, 'none', 0);
  await mouse('mousePressed', cand.value.x, cand.value.y, 'left', 1);
  await mouse('mouseReleased', cand.value.x, cand.value.y, 'left', 0);
  await sleep(4000);

  const res = await evaluate(`(() => {
    const modal = document.querySelector('.modal--smart-lyric-container');
    const detail = document.querySelector('.music-detail--container');
    const items = Array.from(detail?.querySelectorAll('.lyric-item') || []).map(e => (e.innerText||'').trim()).filter(Boolean);
    return {
      modalStillOpen: !!modal,
      modalText: modal ? (modal.innerText||'').trim().slice(0, 300) : null,
      lyricHead: items.slice(0, 8),
      lyricCount: items.length,
      detailTop: detail ? (detail.innerText||'').slice(0, 260) : null,
    };
  })()`);
  console.log(JSON.stringify(res.value || res, null, 2));
  ws.close();
})();
