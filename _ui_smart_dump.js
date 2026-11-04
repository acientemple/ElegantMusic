(() => {
  const modal = document.querySelector('.modal--smart-lyric-container');
  if (!modal) return JSON.stringify({ error: 'no smart lyric modal' });
  const qa = (s) => Array.from(modal.querySelectorAll(s));
  const content = modal.querySelector('.smart-lyric-content');
  return JSON.stringify({
    headerText: (modal.querySelector('.components--modal-base-header')?.innerText || '').slice(0, 200),
    toolbar: (modal.querySelector('.smart-lyric-toolbar')?.innerText || '').slice(0, 300),
    contentText: (content?.innerText || '').slice(0, 1500),
    itemCount: qa('.lyric-item').length,
    items: qa('.lyric-item').slice(0, 6).map(e => ({
      title: (e.querySelector('.title')?.innerText || '').trim(),
      artist: (e.querySelector('.artist')?.innerText || '').trim(),
      head: (e.innerText || '').trim().split('\n').slice(0, 4).join(' | ').slice(0, 160),
    })),
    cls: Array.from(new Set(qa('*').map(e => String(e.className)).filter(c => c && c.length < 45))).slice(0, 30),
  }, null, 2);
})()
