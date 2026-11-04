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
    const al = await jget('https://music.163.com/api/search/get', { s: '叶惠美', type: 10, limit: 5, offset: 0 }, NE);
    console.log('专辑:', (al?.result?.albums || []).map(a => `${a.id}:${a.name}`).join(' | '));
    const ye = (al?.result?.albums || []).find(a => a.name === '叶惠美');
    if (ye) {
        const det = await jget('https://music.163.com/api/album/' + ye.id, {}, NE);
        const songs = det?.album?.songs || [];
        songs.forEach(s => console.log('   ', s.id, s.name, '/', art(s), s.duration));
        const qhc = songs.find(s => s.name === '青花瓷');
        if (qhc) {
            const lrc = await jget('https://music.163.com/api/song/lyric', { id: qhc.id, lv: 1, kv: 1, tv: -1 }, NE);
            const lines = (lrc?.lrc?.lyric || '').split(/\r?\n/).filter(l => l.trim());
            console.log('青花瓷 id=', qhc.id, 'lyric lines', lines.length, 'timed', lines.filter(l => /\[\d{1,3}:\d{1,2}/.test(l)).length, 'trans', (lrc?.tlyric?.lyric||'').split(/\r?\n/).filter(l=>l.trim()).length);
        }
    }
})();
