// 查看两个可用引擎的原始字段结构
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HOST = 'https://music.163.com';
const COOKIE = 'os=pc; appver=2.9.7';

async function get(path, params) {
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
        headers: {
            'user-agent': UA,
            referer: 'https://music.163.com/',
            origin: 'https://music.163.com',
            cookie: COOKIE,
        },
    });
    return res.json();
}

(async () => {
    const q = process.argv[2] || '信仰';

    const mob = await get('/api/search/get', { s: q, type: 1, offset: 0, limit: 3 });
    console.log('=== /api/search/get 第1首完整对象 ===');
    console.log(JSON.stringify(mob?.result?.songs?.[0], null, 2));

    const cloud = await get('/api/cloudsearch/pc', { s: q, type: 1, offset: 0, limit: 3 });
    console.log('\n=== /api/cloudsearch/pc 第1首完整对象 ===');
    console.log(JSON.stringify(cloud?.result?.songs?.[0], null, 2));

    // 重复测 web 接口，看 405 是否稳定复现
    console.log('\n=== /api/search/get/web 连续 3 次 ===');
    for (let i = 0; i < 3; i++) {
        const w = await get('/api/search/get/web', {
            csrf_token: '', s: q, type: 1, offset: 0, limit: 50, total: true,
        });
        console.log(`  第${i + 1}次: code=${w.code} msg=${w.msg} songs=${w?.result?.songs?.length}`);
    }

    // song/detail 能补哪些字段
    console.log('\n=== /api/song/detail ===');
    const detail = await get('/api/song/detail', { ids: '[25643328]' });
    const s = detail?.songs?.[0];
    console.log(JSON.stringify({
        id: s?.id, name: s?.name, duration: s?.duration,
        ar: s?.ar, al: s?.al, dt: s?.dt,
    }, null, 2));
})();
