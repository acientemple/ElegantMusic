const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function timed(label, fn) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${Date.now() - t}ms  ok=${!!r}`);
  } catch (e) {
    console.log(`${label}: ${Date.now() - t}ms  ERR=${String(e.message).slice(0, 80)}`);
  }
}

(async () => {
  for (let i = 0; i < 3; i++) {
    console.log(`--- 第 ${i + 1} 轮 ---`);
    await timed('lrclib(青花瓷/周杰伦)', async () => {
      const u = new URL('https://lrclib.net/api/get');
      u.searchParams.set('track_name', '青花瓷');
      u.searchParams.set('artist_name', '周杰伦');
      const res = await fetch(u.toString(), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      return res.ok;
    });
    await timed('qq搜索(青花瓷 周杰伦)', async () => {
      const u = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp');
      u.searchParams.set('p', '1'); u.searchParams.set('n', '10');
      u.searchParams.set('w', '青花瓷 周杰伦'); u.searchParams.set('format', 'json');
      const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' }, signal: AbortSignal.timeout(8000) });
      return res.ok;
    });
    await timed('qq歌词(002qU5aY3Qu24y)', async () => {
      const u = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
      u.searchParams.set('songmid', '002qU5aY3Qu24y'); u.searchParams.set('format', 'json');
      u.searchParams.set('nobase64', '1'); u.searchParams.set('g_tk', '5381');
      const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' }, signal: AbortSignal.timeout(8000) });
      return res.ok;
    });
  }
})();
