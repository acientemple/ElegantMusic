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
    const q = '青花瓷', artist = '周杰伦';

    console.log('===== QQ (原始参数) =====');
    let r = await jget(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=${encodeURIComponent(q + ' ' + artist)}&format=json`,
        { Referer: 'https://y.qq.com/' },
    );
    const list = r.json?.data?.song?.list ?? [];
    console.log('search', r.status, list.length);
    console.log('字段:', Object.keys(list[0] || {}).join(','));
    console.log(list.slice(0, 3).map((s) => `${s.songmid}:${s.songname}/${(s.singer || []).map((x) => x.name).join(',')}/${s.interval}s/${s.albumname}`).join(' | '));
    if (list[0]) {
        r = await jget(
            `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${list[0].songmid}&format=json&nobase64=1&g_tk=5381`,
            { Referer: 'https://y.qq.com/' },
        );
        console.log('lyric', r.status, 'code', r.json?.code, brief(r.json?.lyric), 'trans', brief(r.json?.trans));
        console.log('  head:', (r.json?.lyric || '').split('\n').slice(0, 2).join(' / '));
    }

    console.log('\n===== 酷狗 krcs 各种参数 =====');
    for (const [label, url] of [
        ['no duration', `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&hash=`],
        ['duration 239394', `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&duration=239394&hash=`],
        ['duration 240000', `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&duration=240000&hash=`],
        ['hash+duration', `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&duration=239394&hash=37A8F50A9EC3B267C3CC6BEC633D9C4A`],
    ]) {
        const r2 = await jget(url, { Referer: 'https://www.kugou.com/' });
        const c = r2.json?.candidates ?? [];
        console.log(label, '->', r2.status, 'candidates', c.length, c[0] ? `hash=${c[0].hash} ak=${String(c[0].accesskey).slice(0, 8)} dur=${c[0].duration}` : '');
    }

    console.log('\n===== 酷狗 getdata（带 album_id） =====');
    const kg = await jget(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(q + ' ' + artist)}&page=1&pagesize=5&platform=web`,
        { Referer: 'https://www.kugou.com/' },
    );
    const s = kg.json?.data?.lists?.[0];
    console.log('song:', s?.SongName, s?.SingerName, 'hash', s?.FileHash, 'albumId', s?.AlbumID, 'dur', s?.Duration, 'audioId', s?.AudioId);
    if (s) {
        const dur = Math.round((s.Duration || 0) * 1000);
        const gd = await jget(
            `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${s.FileHash}&album_id=${s.AlbumID}&album_audio_id=&timelength=${dur}&df=fd&kdt=1&client=pc`,
            { Referer: 'https://www.kugou.com/' },
        );
        console.log('getdata', gd.status, 'status field', gd.json?.status, 'lyric len', (gd.json?.lyric || '').length);
        if (gd.json?.lyric) {
            const dec = Buffer.from(gd.json.lyric, 'base64').toString('utf8');
            console.log('  decoded', brief(dec));
            console.log('  head:', dec.split('\n').slice(0, 3).join(' / '));
        }
    }
})();
