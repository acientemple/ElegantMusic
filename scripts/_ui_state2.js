(() => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? { tag: e.tagName, cls: String(e.className).slice(0, 80), txt: (e.innerText||'').trim().slice(0,40) } : null; };
  return JSON.stringify({
    url: location.hash,
    modals: qa('[class*="modal--"], [class*="mask"], [class*="backdrop"]').map(e => ({ cls: String(e.className).slice(0,60), disp: getComputedStyle(e).display, vis: getComputedStyle(e).visibility, z: getComputedStyle(e).zIndex })),
    detailLike: Array.from(new Set(qa('div').map(e => String(e.className)).filter(c => /detail|panel|aside|drawer/i.test(c)))).slice(0, 15),
    at510_351: at(510, 351),
    at785_383: at(785, 383),
    focused: document.activeElement ? document.activeElement.className : null,
    hasFocus: document.hasFocus(),
  }, null, 2);
})()
