const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
async function raw(url, headers = {}) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, text, json };
    } catch (e) {
        return { status: 'ERR', text: String(e.cause?.code || e.message), json: null };
    }
}
(async () => {
    console.log('===== LRCLIB search =====');
    const s = await raw(`https://lrclib.net/api/search?q=${encodeURIComponent('青花瓷')}`, { Referer: 'https://lrclib.net/' });
    console.log('status', s.status, 'isArray', Array.isArray(s.json), 'len', s.json?.length);
    if (Array.isArray(s.json) && s.json[0]) {
        console.log('keys:', Object.keys(s.json[0]).join(','));
        console.log('sample:', JSON.stringify({
            id: s.json[0].id, track: s.json[0].trackName, artist: s.json[0].artistName,
            album: s.json[0].albumName, dur: s.json[0].duration,
            synced: !!s.json[0].syncedLyrics, plain: !!s.json[0].plainLyrics,
        }));
        // 用 id 取词
        const g = await raw(`https://lrclib.net/api/get?id=${s.json[0].id}`, { Referer: 'https://lrclib.net/' });
        console.log('get by id:', g.status, g.json ? Object.keys(g.json).join(',') : g.text.slice(0, 100));
    }

    console.log('\n===== LRCLIB get 字段 =====');
    const g2 = await raw(`https://lrclib.net/api/get?track_name=${encodeURIComponent('青花瓷')}&artist_name=${encodeURIComponent('周杰伦')}`, { Referer: 'https://lrclib.net/' });
    console.log('status', g2.status, g2.json ? Object.keys(g2.json).join(',') : g2.text.slice(0, 120));

    console.log('\n===== 公共聚合 API 试探 =====');
    const urls = [
        ['vvhan', `https://api.vvhan.com/api/lyric?url=${encodeURIComponent('https://y.qq.com/n/ryqq/songDetail/002qU5aY3Qu24y')}`],
        ['pearktrue', `https://api.pearktrue.cn/api/lyric/?song=${encodeURIComponent('青花瓷')}&artist=${encodeURIComponent('周杰伦')}`],
    ];
    for (const [label, u] of urls) {
        const r = await raw(u);
        console.log(` ${label}: ${r.status} len=${r.text.length}`);
        console.log('   ', r.text.slice(0, 220).replace(/\n/g, ' '));
    }
})();
