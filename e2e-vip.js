(async () => {
  const pm = window['@shared/plugin-manager'];
  const P = { platform: '完整版搜索' };
  const r = await pm.callPluginMethod(P, 'getMediaSource', { id: '1945894789', duration: 238 }, 'standard');
  return JSON.stringify({ returned: r, type: typeof r }, null, 2);
})()
