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
        const hit = songs.findIndex((s) => (s.ar || []).some((a) => /周杰伦|周杰倫/.test(a.name)));
        console.log(`网易云 limit=${limit}: ${songs.length} 条, 首个周杰伦命中 index=${hit}`);
        if (hit >= 0) {
            const s = songs[hit];
            console.log('   ->', s.id, s.name, (s.ar || []).map((a) => a.name).join('/'), s.duration);
        }
    }
    // 直接看 186016 的歌词行数
    const lrc = await jget('https://music.163.com/api/song/lyric', { id: 186016, lv: 1, kv: 1, tv: -1 }, NE);
    const lines = (lrc?.lrc?.lyric || '').split(/\r?\n/).filter((l) => l.trim());
    console.log('网易云 186016 lyric:', lines.length, 'lines, timed', lines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length, 'trans', (lrc?.tlyric?.lyric || '').split(/\r?\n/).filter((l) => l.trim()).length);

    // LRCLIB /api/get 对 青花瓷 的返回
    const g = await jget('https://lrclib.net/api/get', { track_name: '青花瓷', artist_name: '周杰伦' }, { referer: 'https://lrclib.net/' });
    console.log('LRCLIB get 青花瓷:', g?.trackName, '/', g?.artistName, 'synced', (g?.syncedLyrics || '').split('\n').length, 'plain', (g?.plainLyrics || '').split('\n').length, 'dur', g?.duration);

    // QQ 的青花瓷歌词行数
    const ql = await jget('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', { songmid: '002qU5aY3Qu24y', format: 'json', nobase64: 1, g_tk: 5381 }, { referer: 'https://y.qq.com/' });
    const qlines = (ql?.lyric || '').split(/\r?\n/).filter((l) => l.trim());
    console.log('QQ 青花瓷 lyric:', qlines.length, 'lines, timed', qlines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length);
    console.log('   前 3 行:', qlines.slice(0, 3).join(' / '));
    console.log('   后 3 行:', qlines.slice(-3).join(' / '));
})();
