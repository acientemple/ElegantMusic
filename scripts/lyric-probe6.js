const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text), text }; }
    catch { return { status: res.status, json: null, text }; }
}
function brief(lrc) {
    if (!lrc) return 'null';
    const lines = lrc.split(/\r?\n/).filter((l) => l.trim());
    return `lines=${lines.length} timed=${lines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length}`;
}

(async () => {
    const q = '青花瓷 周杰伦';
    const kg = await jget(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(q)}&page=1&pagesize=10&platform=web`,
        { Referer: 'https://www.kugou.com/' },
    );
    const s = kg.json?.data?.lists?.[0];
    const hash = s.FileHash, dur = Math.round(s.Duration * 1000);
    console.log('歌曲:', s.SongName, s.SingerName, 'hash=', hash, 'dur=', dur, 'albumId=', s.AlbumID);

    const ks = await jget(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&hash=${hash}&duration=${dur}`,
        { Referer: 'https://www.kugou.com/' },
    );
    const cands = ks.json?.candidates ?? [];
    console.log('candidates', cands.length);
    cands.slice(0, 3).forEach((c, i) => {
        console.log(`  #${i} id=${c.id} dl=${c.download_id} ak=${c.accesskey} song=${c.song} singer=${c.singer} dur=${c.duration} fmt=${c.content_format}/${c.contenttype} lang=${c.language}`);
    });

    // 尝试：用 FileHash + 各 candidate 的 accesskey
    for (let i = 0; i < Math.min(3, cands.length); i++) {
        const c = cands[i];
        for (const h of [hash, c.download_id, c.id]) {
            if (!h) continue;
            const r = await jget(
                `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${h}&accesskey=${c.accesskey}&duration=${c.duration}&fmt=lrc&charset=utf8`,
                { Referer: 'https://www.kugou.com/' },
            );
            console.log(`lyric h=${String(h).slice(0, 12)} ak#${i} ->`, r.status, 'content?', !!r.json?.content, r.json?.content ? brief(r.json.content) : (r.json ? JSON.stringify(r.json).slice(0, 120) : r.text.slice(0, 80)));
            if (r.json?.content) {
                console.log('   head:', r.json.content.split('\n').slice(0, 3).join(' / '));
                return;
            }
        }
    }

    // 备用：search 时不带 hash
    console.log('\n--- 不带 hash 的 krcs search ---');
    const ks2 = await jget(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent('青花瓷')}&hash=&duration=${dur}`,
        { Referer: 'https://www.kugou.com/' },
    );
    const c2 = ks2.json?.candidates ?? [];
    console.log('count', c2.length);
    c2.slice(0, 3).forEach((c, i) => console.log(`  #${i} id=${c.id} dl=${c.download_id} ak=${c.accesskey} song=${c.song} singer=${c.singer} dur=${c.duration}`));
    if (c2[0]) {
        const r = await jget(
            `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=${c2[0].accesskey}&duration=${c2[0].duration}&fmt=lrc&charset=utf8`,
            { Referer: 'https://www.kugou.com/' },
        );
        console.log('lyric:', r.status, r.json?.content ? brief(r.json.content) : JSON.stringify(r.json).slice(0, 150));
    }
})();
