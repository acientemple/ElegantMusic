(() => {
  const b = document.querySelector('.modal--music-alternatives-container .btn-icon, .modal--music-alternatives-container button');
  if (b) { b.click(); return 'closed'; }
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  return 'esc';
})()
