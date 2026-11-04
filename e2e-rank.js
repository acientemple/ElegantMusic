(async () => {
  const pm = window['@shared/plugin-manager'];
  const fmt = (d) => `${Math.floor(d/60)}:${String(Math.floor(d%60)).padStart(2,'0')}`;
  const cases = [
    { id: '0', platform: 'test', title: '(Everything I Do) I Do It for You', artist: 'Bryan Adams', duration: 396 },
    { id: '0', platform: 'test', title: '信仰', artist: '张信哲', duration: 256 },
    { id: '0', platform: 'test', title: '晴天', artist: '周杰伦', duration: 269 },
  ];
  const out = [];
  for (const c of cases) {
    const t0 = Date.now();
    let res;
    try {
      res = await pm.callPluginMethod({ platform: '完整版搜索' }, 'getMusicAlternatives', c, 1);
    } catch (e) {
      out.push({ title: c.title, error: String(e) });
      continue;
    }
    const data = res?.data || [];
    out.push({
      title: c.title,
      count: data.length,
      originCount: data.filter(x => x.isOriginArtist).length,
      ms: Date.now() - t0,
      top: data.slice(0, 5).map(x => `${x.title} / ${x.artist} / ${fmt(x.duration||0)}${x.isOriginArtist ? ' [原唱]' : ''}`),
    });
  }
  return JSON.stringify(out, null, 2);
})()
