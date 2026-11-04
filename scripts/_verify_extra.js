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

  const probe = async (label, p, ms = 25000) => {
    const t = Date.now();
    const r = await race(p, ms);
    if (r.kind === 'timeout') return (out[label] = { state: '超时' });
    if (r.kind === 'error') return (out[label] = { state: '出错', error: r.e.slice(0, 120) });
    if (r.v === null) return (out[label] = { state: '插件未加载' });
    const data = Array.isArray(r.v.data) ? r.v.data : [];
    return (out[label] = {
      state: '成功',
      ms: Date.now() - t,
      条数: data.length,
      样例: data[0]
        ? `${data[0].title || ''} / ${data[0].artist || ''}`.slice(0, 50)
        : '',
    });
  };

  await probe(
    '免费音乐聚合-jazz',
    m.callPluginMethod({ platform: '免费音乐聚合' }, 'search', 'jazz', 1, 'music'),
    30000,
  );

  const bilibiliItem = (platform) => ({
    id: 'BV1xx411c7mD',
    platform,
    title: '青花瓷',
    artist: '周杰伦',
  });

  for (const plat of ['哔哩哔哩音乐', '哔哩哔哩MV']) {
    const t = Date.now();
    const r = await race(
      m.callPluginMethod({ platform: plat }, 'getLyric', bilibiliItem(plat)),
      20000,
    );
    if (r.kind === 'timeout') out[plat + '-歌词'] = { state: '超时' };
    else if (r.kind === 'error')
      out[plat + '-歌词'] = { state: '出错', error: r.e.slice(0, 100) };
    else if (r.v === null) out[plat + '-歌词'] = { state: '插件未加载' };
    else
      out[plat + '-歌词'] = {
        state: '成功',
        ms: Date.now() - t,
        rawLrc: r.v.rawLrc ? String(r.v.rawLrc).split('\n').filter((x) => x.trim()).length + ' 行' : 'null',
      };
  }

  // 便携版 bundle 是否已包含源码侧的扩展方法转发（getVideoSource / getMusicAlternatives）
  for (const method of ['getVideoSource', 'getMusicAlternatives']) {
    const r = await race(
      m.callPluginMethod({ platform: '哔哩哔哩MV' }, method, { id: 'x', platform: '哔哩哔哩MV', title: '青花瓷' }),
      8000,
    );
    out['扩展方法-' + method] =
      r.kind === 'value'
        ? r.v === null
          ? '主进程未注册该方法（便携版仍是原版 0.0.8 bundle）'
          : '已注册'
        : r.kind === 'timeout'
          ? '超时'
          : '出错: ' + r.e.slice(0, 80);
  }

  return JSON.stringify(out, null, 2);
})()
