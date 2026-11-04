(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = { fnSrc: String(m.callPluginMethod).slice(0, 800) };
  try {
    const r = await m.callPluginMethod('音乐排行榜', 'getLyric', { id: '186016', platform: '音乐排行榜', title: '晴天', artist: '周杰伦' });
    out.rank = r ? Object.keys(r) : null;
    out.rankHead = r && String(r.rawLrc || '').slice(0, 120);
  } catch (e) {
    out.rankErr = String((e && e.message) || e);
  }
  return JSON.stringify(out, null, 2);
})()
