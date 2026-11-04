(async () => {
  const pm = window['@shared/plugin-manager'];
  const m = pm.default || pm;
  const out = {};

  const race = (p, ms) =>
    Promise.race([
      Promise.resolve(p).then(
        (v) => ({ kind: 'value', v }),
        (e) => ({ kind: 'error', e: String((e && e.message) || e) }),
      ),
      new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), ms)),
    ]);

  // 1. MV 视频源：先搜一条真实条目拿到 bvid，再取视频流
  try {
    const sr = await race(
      m.callPluginMethod({ platform: '哔哩哔哩MV' }, 'search', '周杰伦', 1, 'music'),
      20000,
    );
    const item = sr.v && Array.isArray(sr.v.data) ? sr.v.data[0] : null;
    if (!item) throw new Error('搜索无结果');
    const vr = await race(
      m.callPluginMethod(
        { platform: '哔哩哔哩MV' },
        'getVideoSource',
        { id: item.id, platform: '哔哩哔哩MV', title: item.title, artist: item.artist },
        'standard',
      ),
      20000,
    );
    out['MV视频源'] = {
      标题: String(item.title || '').slice(0, 40),
      bvid: item.id,
      状态: vr.kind === 'value' ? (vr.v ? '成功' : '返回null') : vr.kind,
      宽高: vr.v ? `${vr.v.width}x${vr.v.height}` : '',
      有url: vr.v ? String(vr.v.url || '').slice(0, 60) : '',
      带请求头: vr.v ? Object.keys(vr.v.headers || {}).join(',') : '',
    };
  } catch (e) {
    out['MV视频源'] = { 状态: '异常', 错误: String((e && e.message) || e).slice(0, 120) };
  }

  // 2. 搜索完整播放版本：拿一条网易云歌曲，找可整轨播放的候选
  try {
    const sr = await race(
      m.callPluginMethod({ platform: '完整版搜索' }, 'search', '青花瓷', 1, 'music'),
      20000,
    );
    const item = sr.v && Array.isArray(sr.v.data) ? sr.v.data[0] : null;
    if (!item) throw new Error('搜索无结果');
    const ar = await race(
      m.callPluginMethod(
        { platform: '完整版搜索' },
        'getMusicAlternatives',
        { id: item.id, platform: '完整版搜索', title: item.title, artist: item.artist },
      ),
      30000,
    );
    const list = ar.v && Array.isArray(ar.v.data) ? ar.v.data : [];
    out['完整版候选'] = {
      原曲: `${item.title || ''} / ${item.artist || ''}`.slice(0, 40),
      状态: ar.kind === 'value' ? (ar.v ? '成功' : '返回null') : ar.kind,
      候选数: list.length,
      前3条: list.slice(0, 3).map((x) => ({
        歌名: x.title,
        歌手: x.artist,
        时长: x.duration,
        原唱: x.isOriginArtist ? '是' : '',
      })),
    };
  } catch (e) {
    out['完整版候选'] = { 状态: '异常', 错误: String((e && e.message) || e).slice(0, 120) };
  }

  return JSON.stringify(out, null, 2);
})()
