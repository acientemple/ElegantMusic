(async () => {
  const pm = window['@shared/plugin-manager'];
  const P = { platform: '完整版搜索' };
  const getSource = (item, q) => pm.callPluginMethod(P, 'getMediaSource', item, q || 'standard');

  // 1) 找一首完整版候选
  const res = await pm.callPluginMethod(P, 'getMusicAlternatives',
    { id: '0', platform: 'test', title: '信仰', artist: '张信哲', duration: 256 }, 1);
  const item = res.data[0];
  const src = await getSource(item, 'standard');

  // 2) 在渲染进程里真实解码，拿到音频时长
  const audio = document.createElement('audio');
  audio.src = src.url;
  audio.muted = true;
  const duration = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), 20000);
    audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration); };
    audio.onerror = () => { clearTimeout(timer); resolve(-2); };
  });

  // 3) 试听片段应被拒绝
  let vipMsg = '';
  try {
    await getSource({ id: '1945894789', duration: 238 });
  } catch (e) { vipMsg = String(e.message || e); }

  return JSON.stringify({
    candidate: { title: item.title, artist: item.artist, declaredDuration: item.duration },
    audioDuration: duration,
    audioDurationIsFull: duration > 200,
    vipRejected: vipMsg,
  }, null, 2);
})()
