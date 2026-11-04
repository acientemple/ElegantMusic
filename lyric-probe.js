// 探测各歌词平台的可用性
const UA_PC =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(url, opts = {}) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA_PC,
            Referer: 'https://music.163.com',
            ...(opts.headers || {}),
        },
        ...opts,
    });
    const text = await res.text();
    return { status: res.status, text, res };
}

function brief(lrc) {
    if (!lrc) return { lines: 0 };
    const lines = lrc
        .split(/\r?\n/)
        .map((l) => l.replace(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g, '').trim())
        .filter(Boolean);
    return { lines: lines.length, sample: lines.slice(0, 2) };
}

(async () => {
    const q = process.argv[2] || '青花瓷';
    const artist = process.argv[3] || '周杰伦';
    const neteaseId = process.argv[4] || '186016';

    // ---------- 1. 网易云：先搜索拿 id ----------
    console.log('===== 网易云 =====');
    try {
        const r = await get(
            `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=5&offset=0`,
            { headers: { cookie: 'os=pc; appver=2.9.7', Referer: 'https://music.163.com', Origin: 'https://music.163.com' } },
        );
        const j = JSON.parse(r.text);
        const songs = j?.result?.songs ?? [];
        console.log('search status', r.status, 'count', songs.length, songs.slice(0, 3).map((s) => `${s.id}:${s.name}/${s.artists?.[0]?.name}`).join(' | '));
    } catch (e) {
        console.log('search ERR', e.message);
    }
    try {
        const r = await get(
            `https://music.163.com/api/song/lyric?id=${neteaseId}&lv=1&kv=1&tv=-1`,
            { headers: { cookie: 'os=pc; appver=2.9.7', Referer: 'https://music.163.com', Origin: 'https://music.163.com' } },
        );
        const j = JSON.parse(r.text);
        console.log('lyric status', r.status, 'lrc:', JSON.stringify(brief(j?.lrc?.lyric)), 'tlyric:', JSON.stringify(brief(j?.tlyric?.lyric)));
        console.log('  lrc head:', (j?.lrc?.lyric || '').split('\n').slice(0, 3).join(' / '));
    } catch (e) {
        console.log('lyric ERR', e.message);
    }

    // ---------- 2. 酷狗 KRC ----------
    console.log('\n===== 酷狗 =====');
    try {
        const r = await get(
            `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}%20${encodeURIComponent(artist)}&duration=240000&hash=`,
            { headers: { Referer: 'https://www.kugou.com/' } },
        );
        const j = JSON.parse(r.text);
        const cands = j?.candidates ?? [];
        console.log('search status', r.status, 'count', cands.length, cands.slice(0, 3).map((c) => `${c.song}/${c.singername}(${c.duration}ms)`).join(' | '));
        if (cands[0]) {
            const c = cands[0];
            const r2 = await get(
                `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${c.hash}&accesskey=${c.accesskey}&duration=${c.duration}&fmt=lrc&charset=utf8`,
                { headers: { Referer: 'https://www.kugou.com/' } },
            );
            const j2 = JSON.parse(r2.text);
            console.log('lyric status', r2.status, 'content:', JSON.stringify(brief(j2?.content)));
            console.log('  head:', (j2?.content || '').split('\n').slice(0, 3).join(' / '));
        }
    } catch (e) {
        console.log('ERR', e.message);
    }

    // ---------- 3. QQ 音乐 ----------
    console.log('\n===== QQ音乐 =====');
    try {
        const body = {
            comm: { ct: 24, cv: 0 },
            req: {
                method: 'DoSearchForQQMusicDesktop',
                module: 'music.search.SearchCgiService',
                param: { query: `${q} ${artist}`, num_per_page: 5, page_num: 1, search_type: 0 },
            },
        };
        const r = await get('https://u.y.qq.com/cgi-bin/musicu.fcg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
            body: JSON.stringify(body),
        });
        const j = JSON.parse(r.text);
        const list = j?.req?.data?.body?.song?.list ?? [];
        console.log(
            'search status',
            r.status,
            'count',
            list.length,
            list
                .slice(0, 3)
                .map((s) => `${s.mid}:${s.title}/${(s.singer ?? []).map((x) => x.name).join(',')}`)
                .join(' | '),
        );
        if (list[0]) {
            const r2 = await get(
                `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${list[0].mid}&format=json&nobase64=1&g_tk=5381`,
                { headers: { Referer: 'https://y.qq.com/' } },
            );
            const j2 = JSON.parse(r2.text);
            console.log('lyric status', r2.status, 'code', j2?.code, 'content:', JSON.stringify(brief(j2?.lyric)));
            console.log('  head:', (j2?.lyric || '').split('\n').slice(0, 3).join(' / '));
        }
    } catch (e) {
        console.log('ERR', e.message, e.stack?.split('\n')[1]);
    }

    // ---------- 4. LRCLIB ----------
    console.log('\n===== LRCLIB =====');
    try {
        const r = await get(
            `https://lrclib.net/api/get?track_name=${encodeURIComponent(q)}&artist_name=${encodeURIComponent(artist)}`,
            { headers: { Referer: 'https://lrclib.net/' } },
        );
        console.log('status', r.status, r.text.slice(0, 200));
    } catch (e) {
        console.log('ERR', e.message);
    }

    // ---------- 5. 网易云 备用：song/detail 确认 id ----------
    console.log('\n===== 网易云 detail =====');
    try {
        const r = await get(`https://music.163.com/api/song/detail?ids=[${neteaseId}]`, {
            headers: { cookie: 'os=pc; appver=2.9.7', Referer: 'https://music.163.com' },
        });
        const j = JSON.parse(r.text);
        const s = j?.songs?.[0];
        console.log('status', r.status, s?.name, s?.artists?.map((a) => a.name).join(','), s?.duration + 'ms');
    } catch (e) {
        console.log('ERR', e.message);
    }
})();
