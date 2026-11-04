(() => {
  const all = Array.from(document.querySelectorAll('*'));
  const rows = all.filter(el => {
    const t = (el.innerText||'').trim();
    return t.includes('Because You Loved Me') && el.children.length <= 6 && el.getBoundingClientRect().height > 10;
  }).map(el => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className?.toString?.().slice(0,60), x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), h: Math.round(r.height), text: (el.innerText||'').trim().slice(0,60) };
  });
  return JSON.stringify(rows.slice(0,6), null, 2);
})()
