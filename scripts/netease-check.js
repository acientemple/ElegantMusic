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
    for (const q of ['晴天', '稻香', 'Hello', 'Shape of You']) {
        const d = await jget('https://music.163.com/api/search/get', { s: q, type: 1, limit: 10, offset: 0 }, NE);
        const songs = d?.result?.songs || [];
        console.log(`\n[${q}] ${songs.length} 条`);
        songs.slice(0, 6).forEach((s, i) => console.log(`   ${i}. ${s.id} ${s.name} / ${art(s)}`));
    }
})();
