(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const r = await m.callPluginMethod('lyric-source', 'search', '青花瓷', 1, 'lyric');
  return JSON.stringify({ keys: Object.keys(r||{}), r }, null, 2).slice(0, 3000);
})()
