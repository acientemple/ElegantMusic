(() => {
  const pm = window['@shared/plugin-manager'];
  const keys = Object.keys(pm);
  const defaults = pm.default ? Object.keys(pm.default) : [];
  return JSON.stringify({ moduleKeys: keys, defaultKeys: defaults }, null, 2);
})()
