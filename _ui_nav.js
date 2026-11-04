(() => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const nav = qa('.nav-item, [class*="nav"]').filter(e => (e.innerText || '').trim())
    .map(e => ({ cls: e.className, text: (e.innerText || '').trim().slice(0, 20) })).slice(0, 20);
  const inputs = qa('input').map(e => ({
    cls: e.className, ph: e.placeholder, type: e.type,
    rect: (() => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })(),
  }));
  return JSON.stringify({ nav, inputs }, null, 2);
})()
