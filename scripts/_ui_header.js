(() => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const input = document.querySelector('.header-search-input');
  const header = document.querySelector('[class*="header"]');
  return JSON.stringify({
    inputValue: input ? input.value : null,
    active: document.activeElement ? document.activeElement.className : null,
    headerHtml: header ? header.innerHTML.slice(0, 1200) : null,
    headerText: header ? header.innerText.slice(0, 300) : null,
    clickables: qa('a,button,[role="button"],[class*="nav"],[class*="tab"]').map(e => ({
      cls: String(e.className).slice(0, 60), txt: (e.innerText || '').trim().slice(0, 20),
    })).slice(0, 30),
  }, null, 2);
})()
