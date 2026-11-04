// 验证各平台的 搜索→取词 链路
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function jget(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
    });
    const text = await res.text();
    try {
        return { status: res.status, json: JSON.parse(text), text };
    } catch {
        return { status: res.status, json: null, text };
    }
}

function brief(lrc) {
    if (!lrc) return 'null';
    const lines = lrc.split(/\r?\n/).filter((l) => l.trim());
    const timed = lines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length;
    return `lines=${lines.length} timed=${timed}`;
}

(async () => {
    const q = process.argv[2] || '青花瓷';
    const artist = process.argv[3] || '周杰伦';

    // ---------- 网易云（无 cookie） ----------
    console.log('===== 网易云（无 cookie） =====');
    let r = await jget(
        `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=5&offset=0`,
        { Referer: 'https://music.163.com', Origin: 'https://music.163.com' },
    );
    let songs = r.json?.result?.songs ?? [];
    console.log('search', r.status, songs.length, songs.slice(0, 3).map((s) => `${s.id}:${s.name}`).join(' | '));
    if (songs[0]) {
        r = await jget(
            `https://music.163.com/api/song/lyric?id=${songs[0].id}&lv=1&kv=1&tv=-1`,
            { Referer: 'https://music.163.com' },
        );
        console.log('lyric', r.status, brief(r.json?.lrc?.lyric), 'trans', brief(r.json?.tlyric?.lyric));
    }

    // ---------- QQ ----------
    console.log('\n===== QQ =====');
    r = await jget(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=${encodeURIComponent(q + ' ' + artist)}&format=json&t=0&new_json=1`,
        { Referer: 'https://y.qq.com/' },
    );
    const qqList = r.json?.data?.song?.list ?? [];
    console.log('search', r.status, qqList.length, qqList.slice(0, 3).map((s) => `${s.songmid}:${s.songname}/${(s.singer || []).map((x) => x.name).join(',')}`).join(' | '));
    if (qqList[0]) {
        const mid = qqList[0].songmid;
        r = await jget(
            `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1&g_tk=5381`,
            { Referer: 'https://y.qq.com/' },
        );
        console.log('lyric', r.status, 'code', r.json?.code, brief(r.json?.lyric), 'trans', brief(r.json?.trans));
        console.log('  head:', (r.json?.lyric || '').split('\n').slice(0, 2).join(' / '));
        console.log('  trans head:', (r.json?.trans || '').split('\n').slice(0, 2).join(' / '));
    }

    // ---------- 酷狗 ----------
    console.log('\n===== 酷狗 =====');
    r = await jget(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(q + ' ' + artist)}&page=1&pagesize=10&platform=web`,
        { Referer: 'https://www.kugou.com/' },
    );
    const kgList = r.json?.data?.lists ?? [];
    console.log('search', r.status, kgList.length, kgList.slice(0, 3).map((s) => `${s.FileHash}:${s.SongName}/${s.SingerName}(${s.Duration}s)`).join(' | '));
    if (kgList[0]) {
        const hash = kgList[0].FileHash;
        const dur = Math.round((kgList[0].Duration || 0) * 1000);
        // 方式 A：krcs search 拿 accesskey
        const ka = await jget(
            `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&duration=${dur}&hash=`,
            { Referer: 'https://www.kugou.com/' },
        );
        const cand = ka.json?.candidates ?? [];
        console.log('krcs candidates', cand.length, cand[0] ? `${cand[0].hash} dur=${cand[0].duration}` : '');
        if (cand[0]) {
            const kb = await jget(
                `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${cand[0].hash}&accesskey=${cand[0].accesskey}&duration=${cand[0].duration}&fmt=lrc&charset=utf8`,
                { Referer: 'https://www.kugou.com/' },
            );
            console.log('krcs lyric', kb.status, brief(kb.json?.content));
            console.log('  head:', (kb.json?.content || '').split('\n').slice(0, 2).join(' / '));
        }
        // 方式 B：play/getdata
        const kc = await jget(
            `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&album_id=&album_audio_id=&timelength=${dur}&df=fd&kdt=1&client=pc`,
            { Referer: 'https://www.kugou.com/' },
        );
        console.log('getdata', kc.status, 'lyric len', (kc.json?.lyric || '').length);
        if (kc.json?.lyric) {
            const dec = Buffer.from(kc.json.lyric, 'base64').toString('utf8');
            console.log('  decoded:', brief(dec));
            console.log('  head:', dec.split('\n').slice(0, 2).join(' / '));
        }
    }

    // ---------- LRCLIB ----------
    console.log('\n===== LRCLIB =====');
    r = await jget(
        `https://lrclib.net/api/get?track_name=${encodeURIComponent(q)}&artist_name=${encodeURIComponent(artist)}`,
        { Referer: 'https://lrclib.net/' },
    );
    console.log('status', r.status, r.json ? Object.keys(r.json).join(',') : r.text.slice(0, 120));
    if (r.json?.syncedLyrics) console.log('  synced:', brief(r.json.syncedLyrics));
})();
