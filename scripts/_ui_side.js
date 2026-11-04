(() => {
  const items = Array.from(document.querySelectorAll('.side-bar--list-item-container')).map((e) => {
    const r = e.getBoundingClientRect();
    return { txt: (e.innerText || '').trim().slice(0, 20), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  return JSON.stringify(items, null, 2);
})()
