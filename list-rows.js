(() => {
  const rows = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
  const out = rows.slice(0, 12).map((tr, i) => {
    const td = tr.querySelectorAll('td');
    return `${i}: [${td[2]?.innerText || ''}] — ${td[3]?.innerText || ''} (${td[5]?.innerText || ''})`;
  });
  return JSON.stringify({ total: rows.length, rows: out }, null, 2);
})()
