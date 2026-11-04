(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};
  // 看看渲染进程里还有哪些能拿到插件列表的全局
  const globals = Object.keys(window).filter(k => /music|plugin|store|state/i.test(k));
  out.globals = globals;
  out.hasCall = typeof m.callPluginMethod;
  try {
    const r = await m.callPluginMethod('lyric-source', 'search', '青花瓷', 1, 'lyric');
    out.searchOk = Array.isArray(r) ? r.length : typeof r;
    out.sample = Array.isArray(r) ? r.slice(0, 3) : r;
  } catch (e) {
    out.searchErr = String(e && e.message || e);
  }
  return JSON.stringify(out, null, 2);
})()
