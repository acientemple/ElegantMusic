(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};
  const r = await m.callPluginMethod('歌词聚合', 'search', '青花瓷', 1, 'lyric');
  out.type = Object.prototype.toString.call(r);
  out.keys = r ? Object.keys(r) : null;
  out.isArray = Array.isArray(r);
  out.len = r && r.length;
  out.sample = Array.isArray(r) ? r.slice(0, 4) : r;
  return JSON.stringify(out, null, 2).slice(0, 4000);
})()
