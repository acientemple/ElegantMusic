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
const QQH = { referer: 'https://y.qq.com/' };
const LRCH = { referer: 'https://lrclib.net/' };

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[（(\[【《][^）)\]】》]*[）)\]】》]/g, '')
        .replace(/[\s·・\-_~,.，。!！?？'"“”]/g, '');
}
function timed(lrc) {
    return String(lrc || '').split(/\r?\n/).filter((l) => /\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/.test(l)).length;
}
function matchScore(ct, ca, nt, na) {
    const a = normalize(ct), b = normalize(ca), c = normalize(nt), d = normalize(na);
    if (!a || !c) return 0;
    let s = a === c ? 3 : (a.includes(c) || c.includes(a)) ? 1 : 0;
    if (d && b && (b === d || b.includes(d) || d.includes(b))) s += 3;
    return s;
}

async function qqLyric(title, artist) {
    const query = [title, artist].filter(Boolean).join(' ').trim();
    const search = await jget('https://c.y.qq.com/soso/fcgi-bin/client_search_cp', { p: 1, n: 10, w: query, format: 'json' }, QQH);
    const list = search?.data?.song?.list || [];
    const scored = list.map((s) => ({
        songmid: s.songmid,
        name: s.songname,
        singer: (s.singer || []).map((x) => x.name).join('/'),
        score: matchScore(s.songname, (s.singer || []).map((x) => x.name).join('/'), title, artist),
    })).sort((a, b) => b.score - a.score);
    console.log(`  QQ top5 of "${query}":`);
    scored.slice(0, 5).forEach((s) => console.log(`    ${s.score} | ${s.name} / ${s.singer}`));
    const best = scored.filter((s) => s.score >= 4).slice(0, 2);
    const out = [];
    for (const s of best) {
        const l = await jget('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', { songmid: s.songmid, format: 'json', nobase64: 1, g_tk: 5381 }, QQH);
        if (Number(l?.code) === 0 && l?.lyric) out.push({ from: 'qq:' + s.songmid, lrc: l.lyric, trans: l.trans });
    }
    return out;
}

async function lrclibLyric(title, artist) {
    const d = await jget('https://lrclib.net/api/get', { track_name: title, artist_name: artist }, LRCH);
    if (d && d.syncedLyrics) return [{ from: 'lrclib', lrc: d.syncedLyrics, trans: '' }];
    return [];
}

(async () => {
    const cases = [
        ['青花瓷', '周杰伦'],
        ['孤勇者', '陈奕迅'],
        ['Shape of You', 'Ed Sheeran'],
        ['夜曲', '周杰伦'],
        ['起风了', '买辣椒也用券'],
    ];
    for (const [title, artist] of cases) {
        console.log(`\n===== ${title} / ${artist} =====`);
        const t0 = Date.now();
        const [qq, lr] = await Promise.all([qqLyric(title, artist), lrclibLyric(title, artist)]);
        console.log(`  (${Date.now() - t0}ms)`);
        [...qq, ...lr].forEach((r) => console.log(`  ${r.from}: timed=${timed(r.lrc)} trans=${timed(r.trans)}`));
    }
})();
