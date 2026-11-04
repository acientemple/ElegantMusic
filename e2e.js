(async () => {
  const pm = window['@shared/plugin-manager'];
  const out = [];
  // 先确认插件已加载
  const supported = pm.callPluginMethod;
  const res = await pm.callPluginMethod({
    platform: '完整版搜索',
  }, 'getMusicAlternatives', { id: '0', platform: 'test', title: '信仰', artist: '张信哲', duration: 256 }, 1).catch(e => ({ error: String(e) }));
  return JSON.stringify({ hasError: !!res?.error, error: res?.error, count: res?.data?.length, sample: (res?.data||[]).slice(0,3) }, null, 2);
})()
