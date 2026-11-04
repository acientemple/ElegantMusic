(() => {
  const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
  const all = Array.from(document.querySelectorAll('tbody tr')).length;
  const containers = Array.from(document.querySelectorAll('[class*="music-list"]')).map(e => String(e.className));
  return JSON.stringify({
    trs: trs.length,
    allTbodyTr: all,
    containers,
    firstTitles: trs.slice(0, 3).map(t => {
      const td = t.querySelectorAll('td');
      return { n: td.length, c2: JSON.stringify((td[2]?.innerText || '').slice(0, 30)) };
    }),
    hashes: trs.slice(0, 3).map(t => Array.from(t.querySelectorAll('td')).map(x => (x.innerText||'').slice(0,12))),
  }, null, 2);
})()
