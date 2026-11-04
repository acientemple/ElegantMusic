(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};
  try {
    const r = await m.callPluginMethod({ platform: '歌词聚合' }, 'search', '青花瓷', 1, 'lyric');
    out.isArray = Array.isArray(r);
    out.len = r && r.length;
    out.sample = Array.isArray(r) ? r.slice(0, 3) : r;
  } catch (e) {
    out.err = String((e && e.message) || e);
  }
  return JSON.stringify(out, null, 2).slice(0, 3000);
})()
