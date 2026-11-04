(() => {
  const detail = document.querySelector('.music-detail--container');
  if (!detail) return JSON.stringify({ error: 'no detail' });
  const qa = (s) => Array.from(detail.querySelectorAll(s));
  return JSON.stringify({
    text: (detail.innerText || '').slice(0, 400),
    classes: Array.from(new Set(qa('div').map(e => String(e.className)).filter(c => c && c.length < 45))).slice(0, 30),
    lyricLike: qa('[class*="lyric"]').map(e => ({ cls: String(e.className).slice(0,40), y: Math.round(e.getBoundingClientRect().y), h: Math.round(e.getBoundingClientRect().height) })).slice(0, 10),
  }, null, 2);
})()
