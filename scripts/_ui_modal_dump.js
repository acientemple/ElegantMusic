(() => {
  const modal = document.querySelector('.modal--search-lyric-container');
  if (!modal) return JSON.stringify({ error: 'no modal' });
  const qa = (s) => Array.from(modal.querySelectorAll(s));
  return JSON.stringify({
    html: modal.innerHTML.length,
    texts: qa('div,span,li,p').map(e => (e.innerText || '').trim()).filter(t => t && t.length < 30).slice(0, 60),
    classNames: Array.from(new Set(qa('*').map(e => String(e.className)).filter(c => c && c.length < 40))).slice(0, 40),
    inputs: qa('input').map(e => ({ cls: e.className, value: e.value, ph: e.placeholder })),
  }, null, 2);
})()
