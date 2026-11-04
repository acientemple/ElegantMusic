// 派发 dblclick 播放歌曲 → 底栏出现 → 点底栏歌名打开详情
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

  const dbl = await evaluate(`(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    const tr = trs.find(t => (t.querySelectorAll('td')[2]?.innerText||'').includes('Because You Loved Me')) || trs[0];
    if (!tr) return { error: 'no row' };
    const td = tr.querySelectorAll('td')[2];
    const title = (td.innerText||'').trim();
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, detail: 2 };
    td.dispatchEvent(new MouseEvent('dblclick', opts));
    return { title };
  })()`);
  console.log('dblclick:', JSON.stringify(dbl.value || dbl));
  await sleep(4000);

  const bar = await evaluate(`(() => {
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const bars = qa('[class*="music-bar"]');
    const info = qa('[class*="music-info"], [class*="music-bar"] [class*="info"]');
    return {
      barCount: bars.length,
      barText: bars.map(b => (b.innerText||'').trim().slice(0,120)).filter(Boolean),
      clickable: info.map(e => { const r = e.getBoundingClientRect(); return { cls: String(e.className).slice(0,40), txt: (e.innerText||'').trim().slice(0,40), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; }).filter(o => o.x > 0 && o.y > 0),
    };
  })()`);
  console.log('底栏:', JSON.stringify(bar.value || bar, null, 2));
  ws.close();
})();
