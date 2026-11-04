(() => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const list = document.querySelector('.music-list-container');
  return JSON.stringify({
    url: location.hash,
    headers: qa('[class*="header-title"], .header-subtitle, h1, h2').map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,6),
    sideActive: qa('.side-bar--list-item-container').filter(e => String(e.className).includes('active')).map(e => (e.innerText||'').trim()),
    firstRows: qa('.music-list-container tbody tr').slice(0,5).map(t => { const td = t.querySelectorAll('td'); return [(td[2]?.innerText||'').trim(), (td[6]?.innerText||'').trim()]; }),
    searchPanel: qa('.search-in-music-list-container').map(e => ({ vis: e.getBoundingClientRect().width > 0, txt: (e.innerText||'').slice(0,120) })),
    headerInput: document.querySelector('.header-search-input')?.value,
    modalOpen: qa('.modal--search-lyric-container, .modal--smart-lyric-container').filter(e => e.getBoundingClientRect().width > 0).length,
  }, null, 2);
})()
