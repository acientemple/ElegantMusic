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
    console.log('===== 酷狗 krcs 候选结构 =====');
    const r = await jget(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent('青花瓷')}&hash=37A8F50A9EC3B267C3CC6BEC633D9C4A&duration=239394`,
        { Referer: 'https://www.kugou.com/' },
    );
    const cands = r.json?.candidates ?? [];
    console.log('count', cands.length);
    if (cands[0]) {
        console.log('keys:', Object.keys(cands[0]).join(','));
        const slim = {};
        ['id', 'hash', 'accesskey', 'duration', 'song', 'singer', 'singername', 'audio_id', 'product_from'].forEach((k) => { if (cands[0][k] !== undefined) slim[k] = cands[0][k]; });
        console.log('sample:', JSON.stringify(slim));

        const hash = cands[0].hash || cands[0].id;
        for (const fmt of ['lrc', 'krc']) {
            const lr = await jget(
                `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=${cands[0].accesskey}&duration=${cands[0].duration}&fmt=${fmt}&charset=utf8`,
                { Referer: 'https://www.kugou.com/' },
            );
            console.log(`lyric fmt=${fmt}`, lr.status, 'status field', lr.json?.status, brief(lr.json?.content));
            if (lr.json?.content) console.log('  head:', lr.json.content.split('\n').slice(0, 2).join(' / '));
        }
    }

    console.log('\n===== QQ 歌词响应字段 =====');
    const qr = await jget(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=002qU5aY3Qu24y&format=json&nobase64=1&g_tk=5381`,
        { Referer: 'https://y.qq.com/' },
    );
    console.log('keys:', Object.keys(qr.json || {}).join(','));
    console.log('lyric:', brief(qr.json?.lyric), 'trans:', brief(qr.json?.trans));
    console.log('trans head:', (qr.json?.trans || '').split('\n').slice(0, 3).join(' / '));

    console.log('\n===== 英文歌：QQ / 网易云 / LRCLIB 对比 =====');
    const eq = 'Shape of You', ea = 'Ed Sheeran';
    const nq = await jget(
        `https://music.163.com/api/search/get?s=${encodeURIComponent(eq)}&type=1&limit=3&offset=0`,
        { Referer: 'https://music.163.com' },
    );
    const ns = nq.json?.result?.songs ?? [];
    console.log('网易云:', ns.map((s) => `${s.id}:${s.name}`).join(' | '));
    if (ns[0]) {
        const nl = await jget(`https://music.163.com/api/song/lyric?id=${ns[0].id}&lv=1&kv=1&tv=-1`, { Referer: 'https://music.163.com' });
        console.log('  lyric:', brief(nl.json?.lrc?.lyric), 'trans:', brief(nl.json?.tlyric?.lyric));
    }
    const qq = await jget(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=${encodeURIComponent(eq + ' ' + ea)}&format=json`,
        { Referer: 'https://y.qq.com/' },
    );
    const ql = qq.json?.data?.song?.list ?? [];
    console.log('QQ:', ql.map((s) => `${s.songmid}:${s.songname}`).join(' | '));
    if (ql[0]) {
        const qlr = await jget(
            `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${ql[0].songmid}&format=json&nobase64=1&g_tk=5381`,
            { Referer: 'https://y.qq.com/' },
        );
        console.log('  lyric:', brief(qlr.json?.lyric), 'trans:', brief(qlr.json?.trans));
        console.log('  head:', (qlr.json?.lyric || '').split('\n').slice(0, 2).join(' / '));
    }
    const lr = await jget(`https://lrclib.net/api/get?track_name=${encodeURIComponent(eq)}&artist_name=${encodeURIComponent(ea)}`, { Referer: 'https://lrclib.net/' });
    console.log('LRCLIB:', lr.status, lr.json ? brief(lr.json.syncedLyrics) : lr.text.slice(0, 100));
})();
