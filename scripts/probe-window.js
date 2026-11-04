(() => {
  const keys = Object.keys(window).filter(k => /plugin|musicfree|music|env/i.test(k));
  return JSON.stringify({ keys, bodyStart: document.body.innerText.slice(0, 300) }, null, 2);
})()
