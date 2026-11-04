(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = [];
  const rows = Array.from(document.querySelectorAll('.music-list-container tbody tr')).filter(tr => tr.querySelectorAll('td').length > 2);
  if (!rows.length) return JSON.stringify({ error: '找不到音乐行' });
  const row = rows[0];
  const title = (row.querySelectorAll('td')[1]?.innerText || '').trim();
  const artist = (row.querySelectorAll('td')[2]?.innerText || '').trim();
  log.push(`目标歌曲: ${title} - ${artist}`);

  const cell = row.querySelectorAll('td')[1];
  const r = cell.getBoundingClientRect();
  const x = r.x + r.width/2, y = r.y + r.height/2;
  cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  await sleep(800);

  const items = Array.from(document.querySelectorAll('*')).filter(el => {
    const t = (el.textContent||'').trim();
    return t === '搜索完整播放版本' && el.children.length === 0;
  });
  log.push('菜单项数量=' + items.length);
  if (!items.length) {
    const menus = Array.from(document.querySelectorAll('div')).filter(el => {
      const t = (el.innerText||'');
      return t.includes('完整播放') && t.length < 300;
    }).map(el => el.innerText.replace(/\n/g,' | ').slice(0,250));
    return JSON.stringify({ log, menus: menus.slice(0,5) }, null, 2);
  }
  items[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  await sleep(5000);

  const modal = document.querySelector('.modal--music-alternatives-container');
  const list = modal ? Array.from(modal.querySelectorAll('.alternative-item')).map(el => {
    const t = el.querySelector('.title')?.innerText || '';
    const a = el.querySelector('.artist')?.innerText || '';
    const tags = Array.from(el.querySelectorAll('.origin-tag, .full-tag')).map(x=>x.innerText);
    const d = el.querySelector('.duration')?.innerText || '';
    const img = el.querySelector('img')?.getAttribute('src') || '';
    return `${t} | ${a} | [${tags.join(',')}] | ${d} | img:${img.slice(0,40)}`;
  }) : null;
  return JSON.stringify({ log, modalFound: !!modal, subtitle: modal?.querySelector('.alternatives-subtitle')?.innerText, count: list?.length, rows: (list||[]).slice(0,8) }, null, 2);
})()
