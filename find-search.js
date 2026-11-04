(() => {
  const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName, type: el.type, cls: el.className?.toString?.().slice(0, 60),
      ph: el.placeholder, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width),
    };
  });
  const navs = Array.from(document.querySelectorAll('.side-bar--list-item-container, .side-bar--list-item')).map(el => (el.innerText||'').trim()).filter(Boolean).slice(0, 20);
  return JSON.stringify({ inputs, navs, hash: location.hash }, null, 2);
})()
