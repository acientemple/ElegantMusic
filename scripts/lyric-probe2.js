const UA_PC =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

(async () => {
    const q = process.argv[2] || '青花瓷';
    const artist = process.argv[3] || '周杰伦';

    console.log('--- kugou raw ---');
    const kr = await fetch(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(q)}&duration=240000&hash=`,
        { headers: { 'User-Agent': UA_PC, Referer: 'https://www.kugou.com/' } },
    );
    console.log(kr.status, (await kr.text()).slice(0, 600));

    console.log('\n--- kugou search v2 (songsearch) ---');
    const kr2 = await fetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(q)}&page=1&pagesize=5&platform=web`,
        { headers: { 'User-Agent': UA_PC, Referer: 'https://www.kugou.com/' } },
    );
    const kt = await kr2.text();
    console.log(kr2.status, kt.slice(0, 500));

    console.log('\n--- qq musicu raw ---');
    const body = {
        comm: { ct: 24, cv: 0 },
        req: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: { query: `${q} ${artist}`, num_per_page: 5, page_num: 1, search_type: 0 },
        },
    };
    const qr = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
            'User-Agent': UA_PC,
            'Content-Type': 'application/json',
            Referer: 'https://y.qq.com/',
            Origin: 'https://y.qq.com',
        },
        body: JSON.stringify(body),
    });
    const qt = await qr.text();
    console.log(qr.status, qt.slice(0, 800));

    console.log('\n--- qq simple search ---');
    const qr2 = await fetch(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(q)}&format=json`,
        { headers: { 'User-Agent': UA_PC, Referer: 'https://y.qq.com/' } },
    );
    console.log(qr2.status, (await qr2.text()).slice(0, 400));

    console.log('\n--- netease lyric for a few ids ---');
    for (const id of [186016, 186016, 259138]) {
        const r = await fetch(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
            headers: {
                'User-Agent': UA_PC,
                cookie: 'os=pc; appver=2.9.7',
                Referer: 'https://music.163.com',
            },
        });
        const j = await r.json();
        const lrc = j?.lrc?.lyric ?? '';
        console.log(id, 'lrc lines', lrc.split('\n').length, 'trans lines', (j?.tlyric?.lyric ?? '').split('\n').length, '|', lrc.split('\n')[0]);
    }
})();
