// /api/search/pc 的字段结构与稳定性
const HOST = 'https://music.163.com';
const HEADERS = {
    'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    referer: 'https://music.163.com/',
    origin: 'https://music.163.com',
    cookie: 'os=pc; appver=2.9.7',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XMLHttpRequest',
};

async function get(path, params) {
    const u = new URL(HOST + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    return res.json();
}

(async () => {
    const d = await get('/api/search/pc', { s: '信仰', type: 1, offset: 0, limit: 50 });
    const s = d?.result?.songs?.[0];
    console.log('=== /api/search/pc 首条字段 ===');
    console.log(
        JSON.stringify(
            {
                id: s?.id, name: s?.name,
                ar: s?.ar?.map?.((a) => a.name),
                artists: s?.artists?.map?.((a) => a.name),
                al: s?.al?.name, album: s?.album?.name,
                duration: s?.duration, dt: s?.dt,
                picUrl: s?.al?.picUrl,
                fee: s?.fee,
                privilege: s?.privilege ? { pl: s.privilege.pl, fl: s.privilege.fl, dl: s.privilege.dl, st: s.privilege.st } : undefined,
            },
            null,
            2,
        ),
    );

    console.log('\n=== 稳定性：连续 8 次 /api/search/pc ===');
    for (let i = 0; i < 8; i++) {
        const r = await get('/api/search/pc', { s: '晴天', type: 1, offset: 0, limit: 30 });
        console.log(`  ${i + 1}: code=${r.code} songs=${r?.result?.songs?.length} count=${r?.result?.songCount}`);
        await new Promise((x) => setTimeout(x, 300));
    }

    console.log('\n=== 稳定性：/api/search/get 与 cloudsearch 交替 ===');
    for (let i = 0; i < 4; i++) {
        const a = await get('/api/search/get', { s: '晴天', type: 1, offset: 0, limit: 30 });
        const b = await get('/api/cloudsearch/pc', { s: '晴天', type: 1, offset: 0, limit: 30 });
        console.log(`  ${i + 1}: search/get code=${a.code} n=${a?.result?.songs?.length} | cloudsearch code=${b.code} n=${b?.result?.songs?.length}`);
        await new Promise((x) => setTimeout(x, 300));
    }
})();
