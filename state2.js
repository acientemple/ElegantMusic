(() => {
  const modal = document.querySelector('.modal--music-alternatives-container');
  const overlays = Array.from(document.querySelectorAll('[class*="menu"],[class*="popup"],[class*="context"]'))
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 8)
    .map(el => ({ cls: el.className?.toString?.().slice(0,80), txt: (el.innerText||'').replace(/\n/g,' | ').slice(0,120), z: getComputedStyle(el).zIndex }));
  return JSON.stringify({
    hash: location.hash,
    hasModal: !!modal,
    overlays,
    bodyHead: document.body.innerText.slice(0, 300),
    searchVal: document.querySelector('.header-search-input')?.value,
  }, null, 2);
})()
