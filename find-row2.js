(() => {
  const hits = Array.from(document.querySelectorAll('div,span,p,td')).filter(el => {
    const t = (el.textContent||'').trim();
    return t === 'Because You Loved Me';
  }).map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className?.toString?.().slice(0,50), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), w: Math.round(r.width), h: Math.round(r.height) };
  });
  // 往上找带 contextmenu 处理的祖先
  const withMenu = hits.map(h => {
    let el = document.elementFromPoint(h.x, h.y);
    const chain = [];
    while (el && chain.length < 6) { chain.push(el.tagName + '.' + (el.className?.toString?.().slice(0,40)||'')); el = el.parentElement; }
    return { hit: h, chain };
  });
  return JSON.stringify(withMenu, null, 2);
})()
