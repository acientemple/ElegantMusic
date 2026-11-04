// 对比两个稳定引擎的结果集差异与字段互补性
const HOST = 'https://music.163.com';
const HEADERS = {
    'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    referer: 'https://music.163.com/',
    origin: 'https://music.163.com',
    cookie: 'os=pc; appver=2.9.7',
};

async function get(path, params) {
    const u = new URL(HOST + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    return res.json();
}

(async () => {
    for (const q of ['信仰', '晴天', '海阔天空']) {
        const m = await get('/api/search/get', { s: q, type: 1, offset: 0, limit: 100 });
        const c = await get('/api/cloudsearch/pc', { s: q, type: 1, offset: 0, limit: 100 });
        const mIds = (m?.result?.songs || []).map((s) => s.id);
        const cIds = (c?.result?.songs || []).map((s) => s.id);
        const setM = new Set(mIds);
        const setC = new Set(cIds);
        const onlyM = mIds.filter((i) => !setC.has(i));
        const onlyC = cIds.filter((i) => !setM.has(i));
        console.log(`\n=== ${q} ===`);
        console.log(`  search/get n=${mIds.length} count=${m?.result?.songCount}`);
        console.log(`  cloudsearch n=${cIds.length} count=${c?.result?.songCount}`);
        console.log(`  仅 search/get 有: ${onlyM.length} 个 -> ${onlyM.slice(0, 5)}`);
        console.log(`  仅 cloudsearch 有: ${onlyC.length} 个 -> ${onlyC.slice(0, 5)}`);
        console.log(`  交集: ${mIds.filter((i) => setC.has(i)).length}`);

        // 字段互补性
        const m0 = m?.result?.songs?.[0];
        const c0 = c?.result?.songs?.[0];
        console.log(
            `  search/get 字段: duration=${m0?.duration} artists=${m0?.artists?.length} album.picUrl=${m0?.album?.picUrl ? 'Y' : 'N'} album.picId=${m0?.album?.picId}`,
        );
        console.log(
            `  cloudsearch 字段: dt=${c0?.dt} duration=${c0?.duration} ar=${c0?.ar?.length} al.picUrl=${c0?.al?.picUrl ? 'Y' : 'N'}`,
        );
        await new Promise((x) => setTimeout(x, 400));
    }
})();
