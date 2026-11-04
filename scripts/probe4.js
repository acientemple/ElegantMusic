// 探测：字段补全、limit 上限、歌手歌曲列表作为备用检索源
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HOST = 'https://music.163.com';
const COOKIE = 'os=pc; appver=2.9.7';

async function get(path, params) {
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    try {
        const res = await fetch(url, {
            headers: {
                'user-agent': UA,
                referer: 'https://music.163.com/',
                origin: 'https://music.163.com',
                cookie: COOKIE,
            },
            signal: AbortSignal.timeout(15000),
        });
        return { code: res.status, json: await res.json() };
    } catch (e) {
        return { code: -1, json: { err: String(e.message || e) } };
    }
}

(async () => {
    // 1) limit 上限与 offset 分页
    for (const limit of [50, 100, 200]) {
        const r = await get('/api/search/get', { s: '晴天', type: 1, offset: 0, limit });
        console.log(`search/get limit=${limit} -> songs=${r.json?.result?.songs?.length} count=${r.json?.result?.songCount}`);
    }
    const p1 = await get('/api/search/get', { s: '晴天', type: 1, offset: 0, limit: 50 });
    const p2 = await get('/api/search/get', { s: '晴天', type: 1, offset: 50, limit: 50 });
    console.log(
        `offset 分页: page1 ids[0]=${p1.json?.result?.songs?.[0]?.id} page2 ids[0]=${p2.json?.result?.songs?.[0]?.id}`,
    );

    // 2) cloudsearch 的 limit 上限
    for (const limit of [50, 100]) {
        const r = await get('/api/cloudsearch/pc', { s: '晴天', type: 1, offset: 0, limit });
        console.log(`cloudsearch limit=${limit} -> songs=${r.json?.result?.songs?.length}`);
    }

    // 3) song/detail 字段完整度
    console.log('\n=== /api/song/detail 字段 ===');
    const det = await get('/api/song/detail', { ids: '[25643328]' });
    const s = det.json?.songs?.[0];
    console.log(
        `  id=${s?.id} name=${s?.name} duration=${s?.duration} ar=${s?.ar?.map?.((a) => a.name)} al=${s?.al?.name} picUrl=${s?.al?.picUrl ? 'YES' : 'no'} privilege=${s?.privilege ? 'YES' : 'no'}`,
    );

    // 4) 歌手歌曲列表作为备用检索源
    console.log('\n=== /api/artist/songs (张信哲 id=6454) ===');
    const ar = await get('/api/artist/songs', { id: 6454, limit: 50, offset: 0 });
    console.log(`  code=${ar.json?.code} songs=${ar.json?.songs?.length}`);
    (ar.json?.songs || []).slice(0, 3).forEach((x) =>
        console.log(`   - ${x.name} dur=${x.duration} id=${x.id}`),
    );

    // 5) 原始周杰伦歌曲在两个引擎里的表现
    console.log('\n=== 晴天 原唱 在各引擎的位置 ===');
    const s1 = (p1.json?.result?.songs || []);
    const idx = s1.findIndex((x) => x.name === '晴天' && (x.artists || []).some((a) => a.name === '周杰伦'));
    console.log(`  search/get: 原唱位置=${idx}`);
    const cs = await get('/api/cloudsearch/pc', { s: '晴天', type: 1, offset: 0, limit: 50 });
    const csIdx = (cs.json?.result?.songs || []).findIndex(
        (x) => x.name === '晴天' && (x.ar || []).some((a) => a.name === '周杰伦'),
    );
    console.log(`  cloudsearch: 原唱位置=${csIdx}`);
})();
