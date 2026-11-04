const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
async function jget(url, params, headers = {}) {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}
const NE = { referer: 'https://music.163.com/', origin: 'https://music.163.com', cookie: 'os=pc; appver=2.9.7' };
const art = (s) => (s.ar || s.artists || []).map(a => a.name).join('/');
(async () => {
    const d = await jget('https://music.163.com/api/song/detail', { ids: '[186016]' }, NE);
    console.log('186016 =>', d?.songs?.[0]?.name, '/', art(d?.songs?.[0] || {}), 'dur', d?.songs?.[0]?.duration);

    const tests = [
        ['cloudsearch/pc', 'https://music.163.com/api/cloudsearch/pc', { s: '青花瓷', type: 1, limit: 30, offset: 0 }],
        ['search/get/web', 'https://music.163.com/api/search/get/web', { s: '青花瓷', type: 1, limit: 30, offset: 0, total: true, csrf_token: '' }],
        ['search/get off50', 'https://music.163.com/api/search/get', { s: '青花瓷', type: 1, limit: 50, offset: 50 }],
        ['search/get 歌手', 'https://music.163.com/api/search/get', { s: '周杰伦 青花瓷', type: 1, limit: 30, offset: 0 }],
    ];
    for (const [label, url, params] of tests) {
        const r = await jget(url, params, NE);
        const songs = r?.result?.songs || [];
        const idx = songs.findIndex((s) => String(s.id) === '186016');
        const zhou = songs.findIndex((s) => /周杰伦/.test(art(s)));
        console.log(`${label}: ${songs.length} 条, 186016 index=${idx}, 首个周杰伦 index=${zhou}`);
        if (zhou >= 0) console.log('     ', songs[zhou].id, songs[zhou].name, '/', art(songs[zhou]));
    }
})();
