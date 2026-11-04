(async () => {
  const modal = document.querySelector('.modal--music-alternatives-container');
  if (!modal) return JSON.stringify({ modalFound: false });
  const items = Array.from(modal.querySelectorAll('.alternative-item'));
  const rows = items.map((el, i) => ({
    idx: i,
    title: el.querySelector('.title')?.innerText || '',
    artist: el.querySelector('.artist')?.innerText || '',
    origin: !!el.querySelector('.origin-tag'),
    duration: el.querySelector('.duration')?.innerText || '',
  }));
  return JSON.stringify({ tail: rows.slice(12) }, null, 2);
})()
