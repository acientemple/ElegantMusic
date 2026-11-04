(() => {
  const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
  const vp = { w: window.innerWidth, h: window.innerHeight };
  return JSON.stringify({
    url: location.hash,
    vp,
    trCount: trs.length,
    rows: trs.slice(0, 5).map(t => {
      const td = t.querySelectorAll('td');
      const r = td[2]?.getBoundingClientRect();
      return { title: (td[2]?.innerText || '').trim(), x: r ? Math.round(r.x + r.width / 2) : 0, y: r ? Math.round(r.y + r.height / 2) : 0 };
    }),
    listRect: (() => { const e = document.querySelector('.music-list-container'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    detailExists: !!document.querySelector('.music-detail--container'),
  }, null, 2);
})()
