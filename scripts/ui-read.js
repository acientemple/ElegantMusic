(async () => {
  const modal = document.querySelector('.modal--music-alternatives-container');
  if (!modal) return JSON.stringify({ modalFound: false });
  const items = Array.from(modal.querySelectorAll('.alternative-item'));
  const rows = items.map((el, i) => ({
    idx: i,
    title: el.querySelector('.title')?.innerText || '',
    artist: el.querySelector('.artist')?.innerText || '',
    origin: !!el.querySelector('.origin-tag'),
    full: !!el.querySelector('.full-tag'),
    duration: el.querySelector('.duration')?.innerText || '',
    hasImg: !!el.querySelector('img')?.getAttribute('src'),
  }));
  return JSON.stringify({
    modalFound: true,
    subtitle: modal.querySelector('.alternatives-subtitle')?.innerText || '',
    count: rows.length,
    originCount: rows.filter(r => r.origin).length,
    rows,
  }, null, 2);
})()
