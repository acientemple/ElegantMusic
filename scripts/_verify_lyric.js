(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};

  function brief(lrc) {
    if (!lrc) return 'null';
    const lines = String(lrc).split(/\r?\n/).filter((x) => x.trim());
    return `lines=${lines.length} timed=${lines.filter((x) => /\[\d{1,3}:\d{1,2}/.test(x)).length}`;
  }

  // 1) 聚合插件取词：QQ 原唱
  try {
    const t = Date.now();
    const l = await m.callPluginMethod(
      { platform: '歌词聚合' },
      'getLyric',
      { id: '18f775b3', platform: '歌词聚合', title: '青花瓷', artist: '周杰伦',
        lyricKey: '[{"s":"qq","i":"002qU5aY3Qu24y","t":"青花瓷","a":"周杰伦"}]',
        lyricTitle: '青花瓷', lyricArtist: '周杰伦' },
    );
    out.agg = { ms: Date.now() - t, ...brief(l && l.rawLrc),
      head: String((l && l.rawLrc) || '').split('\n').slice(0, 2).join(' / ') };
  } catch (e) { out.aggErr = String((e && e.message) || e); }

  // 2) 网易云系插件跨源兜底（网易云查不到，QQ/LRCLIB 兜底）
  for (const plat of ['音乐排行榜', '热门歌单', '完整版搜索']) {
    try {
      const t = Date.now();
      const l = await m.callPluginMethod(
        { platform: plat },
        'getLyric',
        { id: '999999999', platform: plat, title: '青花瓷', artist: '周杰伦' },
      );
      out[plat] = { ms: Date.now() - t, ...brief(l && l.rawLrc),
        head: String((l && l.rawLrc) || '').split('\n').slice(0, 2).join(' / ') };
    } catch (e) { out[plat + 'Err'] = String((e && e.message) || e); }
  }

  // 3) 网易云有歌词时仍走原生（晴天）
  try {
    const l = await m.callPluginMethod(
      { platform: '音乐排行榜' },
      'getLyric',
      { id: '186016', platform: '音乐排行榜', title: '晴天', artist: '周杰伦' },
    );
    out.netease = { ...brief(l && l.rawLrc), trans: brief(l && l.translation),
      head: String((l && l.rawLrc) || '').split('\n').slice(0, 2).join(' / ') };
  } catch (e) { out.neteaseErr = String((e && e.message) || e); }

  return JSON.stringify(out, null, 2);
})()
