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
    for (const q of ['青花瓷', '青花瓷 周杰伦']) {
        console.log(`\n=========== query: ${q} ===========`);

        for (const [name, path] of [
            ['search/get', '/api/search/get'],
            ['cloudsearch/pc', '/api/cloudsearch/pc'],
            ['search/pc', '/api/search/pc'],
        ]) {
            try {
                const d = await jget('https://music.163.com' + path, { s: q, type: 1, limit: 10, offset: 0 }, NE);
                const songs = d?.result?.songs || [];
                console.log(` [网易云 ${name}] ${songs.length}`);
                songs.forEach((s, i) => {
                    const art = (s.ar || s.artists || []).map((a) => a.name).join('/');
                    const mark = /周杰伦|周杰倫/.test(art) ? '  <<< 原唱' : '';
                    console.log(`   ${i}. ${s.name} / ${art}${mark}`);
                });
            } catch (e) { console.log('  失败', name, e.message); }
        }

        const qq = await jget('https://c.y.qq.com/soso/fcgi-bin/client_search_cp', { p: 1, n: 10, w: q, format: 'json' }, { referer: 'https://y.qq.com/' });
        console.log(' [QQ]');
        (qq?.data?.song?.list || []).forEach((s, i) => {
            const art = (s.singer || []).map((x) => x.name).join('/');
            const mark = /周杰伦|周杰倫/.test(art) ? '  <<< 原唱' : '';
            console.log(`   ${i}. ${s.songname} / ${art}${mark}`);
        });

        const lr = await jget('https://lrclib.net/api/search', { q: q }, { referer: 'https://lrclib.net/' });
        console.log(' [LRCLIB]');
        (Array.isArray(lr) ? lr : []).slice(0, 10).forEach((s, i) => {
            const mark = /周杰伦|周杰倫|Jay/.test(s.artistName || '') ? '  <<< 原唱' : '';
            console.log(`   ${i}. ${s.trackName} / ${s.artistName}${mark}`);
        });
    }
})();
