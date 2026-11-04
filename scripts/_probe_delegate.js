(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};
  // 试着注册 onPluginUpdated 拿到插件清单
  await new Promise((resolve) => {
    try {
      m.onPluginUpdated((plugins) => {
        out.delegates = plugins.map((p) => ({
          platform: p.platform, hash: p.hash, name: p.name,
          version: p.version, types: p.supportedSearchType,
          primaryKey: p.primaryKey, methods: p.supportedMethod,
        }));
        resolve();
      });
    } catch (e) {
      out.err = String((e && e.message) || e);
      resolve();
    }
    setTimeout(resolve, 1500);
  });
  return JSON.stringify(out, null, 2).slice(0, 5000);
})()
