(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = { plugins: [], lyric: {} };

  const race = (p, ms) =>
    Promise.race([
      Promise.resolve(p).then(
        (v) => ({ kind: 'value', v }),
        (e) => ({ kind: 'error', e: String((e && e.message) || e) }),
      ),
      new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), ms)),
    ]);

  // 主进程 callPluginMethod 按插件 name(=platform) 查找，未加载返回 null；
  // 已加载但调用失败会抛错。用一组不存在的平台名做对照，验证这个判据本身可信。
  const PLATFORMS = [
    ['歌词聚合', 'lyric'],
    ['热门歌单', 'music'],
    ['音乐排行榜', 'music'],
    ['完整版搜索', 'music'],
    ['哔哩哔哩MV', 'music'],
    ['哔哩哔哩音乐', 'music'],
    ['免费音乐聚合', 'music'],
    ['把你的歌单带走', 'sheet'],
    ['__对照组_不存在的平台__', 'music'],
  ];

  out.plugins = await Promise.all(
    PLATFORMS.map(async ([platform, type]) => {
      const t = Date.now();
      const r = await race(
        m.callPluginMethod({ platform }, 'search', '周杰伦', 1, type),
        25000,
      );
      const ms = Date.now() - t;
      if (r.kind === 'timeout') {
        return { platform, type, state: '超时', ms };
      }
      if (r.kind === 'error') {
        return { platform, type, state: '已加载(调用出错)', ms, error: r.e.slice(0, 100) };
      }
      if (r.v === null) {
        return { platform, type, state: '未加载', ms };
      }
      const data = Array.isArray(r.v.data) ? r.v.data : [];
      return {
        platform,
        type,
        state: '已加载',
        ms,
        条数: data.length,
        样例: data[0]
          ? String(data[0].title || data[0].name || '').slice(0, 24)
          : '',
      };
    }),
  );

  const brief = (lrc) => {
    if (!lrc) return 'null';
    const lines = String(lrc).split(/\r?\n/).filter((x) => x.trim());
    const timed = lines.filter((x) => /\[\d{1,3}:\d{1,2}/.test(x)).length;
    return `行数=${lines.length} 带时间轴=${timed}`;
  };
  const headOf = (l, key) =>
    String((l && l[key]) || '')
      .split(/\r?\n/)
      .filter((x) => x.trim())
      .slice(0, 3)
      .join(' | ');

  const LYRIC_JOBS = [
    [
      '歌词聚合',
      {
        id: '18f775b3',
        platform: '歌词聚合',
        title: '青花瓷',
        artist: '周杰伦',
        lyricKey:
          '[{"s":"qq","i":"002qU5aY3Qu24y","t":"青花瓷","a":"周杰伦"}]',
        lyricTitle: '青花瓷',
        lyricArtist: '周杰伦',
      },
    ],
    [
      '音乐排行榜',
      { id: '186016', platform: '音乐排行榜', title: '晴天', artist: '周杰伦' },
    ],
    [
      '热门歌单',
      { id: '999999999', platform: '热门歌单', title: '青花瓷', artist: '周杰伦' },
    ],
    [
      '完整版搜索',
      { id: '999999998', platform: '完整版搜索', title: '青花瓷', artist: '周杰伦' },
    ],
  ];

  for (const [platform, item] of LYRIC_JOBS) {
    const t = Date.now();
    const r = await race(
      m.callPluginMethod({ platform }, 'getLyric', item),
      30000,
    );
    if (r.kind === 'timeout') {
      out.lyric[platform] = { state: '超时' };
    } else if (r.kind === 'error') {
      out.lyric[platform] = { state: '出错', error: r.e.slice(0, 120) };
    } else if (r.v === null) {
      out.lyric[platform] = { state: '插件未加载' };
    } else {
      out.lyric[platform] = {
        state: '成功',
        ms: Date.now() - t,
        rawLrc: brief(r.v.rawLrc),
        translation: brief(r.v.translation),
        首行: headOf(r.v, 'rawLrc'),
      };
    }
  }

  const loaded = out.plugins.filter((p) => p.state.startsWith('已加载')).length;
  const expected = PLATFORMS.length - 1;
  out.结论 =
    loaded === expected
      ? `${expected} 个插件全部加载成功（对照组正确返回未加载）`
      : `插件加载 ${loaded}/${expected}，异常：${out.plugins
          .filter((p) => !p.state.startsWith('已加载'))
          .map((p) => `${p.platform}=${p.state}`)
          .join(', ')}`;

  return JSON.stringify(out, null, 2);
})()
