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
(async () => {
    for (const limit of [20, 30, 50]) {
        const d = await jget('https://music.163.com/api/search/get', { s: '青花瓷', type: 1, limit, offset: 0 }, NE);
        const songs = d?.result?.songs || [];
        const hit = songs.findIndex((s) => (s.ar || s.artists || []).some((a) => /周杰伦|周杰倫/.test(a.name || '')));
        console.log(`limit=${limit}: ${songs.length} 条, 周杰伦命中 index=${hit}`, hit >= 0 ? `id=${songs[hit].id} ${songs[hit].name}` : '');
        if (limit === 20) songs.slice(0, 20).forEach((s, i) => console.log('   ', i, s.id, s.name, '/', (s.ar||s.artists||[]).map(a=>a.name).join('/')));
    }
})();
