(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const plugins = m.plugins || m._plugins || [];
  const list = Array.from(plugins.values ? plugins.values() : plugins).map(p => ({
    platform: p.platform, version: p.version, name: p.name,
    types: p.supportedSearchType, primaryKey: p.primaryKey,
  }));
  return JSON.stringify({ keys: Object.keys(m), list }, null, 2);
})()
