(() => {
  const rows = Array.from(document.querySelectorAll('.music-list-container tr'));
  return JSON.stringify({
    url: location.hash,
    rowCount: rows.length,
    firstRows: rows.slice(0,5).map(tr => (tr.innerText||'').replace(/\n/g,' | ').slice(0,90)),
    modal: !!document.querySelector('.modal--music-alternatives-container'),
    bodyLen: document.body.innerText.length,
  }, null, 2);
})()
