// 尝试救活被限接口 / 扩充引擎池
const HOST = 'https://music.163.com';
const FULL_HEADERS = {
    'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    referer: 'https://music.163.com/',
    origin: 'https://music.163.com',
    cookie: 'os=pc; appver=2.9.7; NMTID=x',
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

async function call(label, { path, method = 'GET', params = {}, body = null }) {
    try {
        let url = HOST + path;
        const opts = { method, headers: { ...FULL_HEADERS }, signal: AbortSignal.timeout(15000) };
        if (method === 'GET') {
            const u = new URL(url);
            for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
            url = u.toString();
        } else {
            opts.body = body ?? new URLSearchParams(params).toString();
            opts.headers['content-type'] = 'application/x-www-form-urlencoded';
        }
        const res = await fetch(url, opts);
        const j = await res.json().catch(() => null);
        const songs = j?.result?.songs?.length;
        console.log(
            `  ${label}: http=${res.status} code=${j?.code} msg=${j?.msg} songs=${songs ?? '-'}`,
        );
    } catch (e) {
        console.log(`  ${label}: ERR ${e.message || e}`);
    }
}

(async () => {
    const s = '信仰';
    console.log('=== web 接口各种尝试 ===');
    await call('GET web 完整浏览器头', { path: '/api/search/get/web', params: { csrf_token: '', s, type: 1, offset: 0, limit: 50, total: true } });
    await call('POST web', { path: '/api/search/get/web', method: 'POST', params: { csrf_token: '', s, type: 1, offset: 0, limit: 50, total: true } });
    await call('GET web 带 NMTID', { path: '/api/search/get/web', params: { csrf_token: '', s, type: 1, offset: 0, limit: 50, total: true } });

    console.log('\n=== 其他候选引擎 ===');
    await call('GET /api/cloudsearch', { path: '/api/cloudsearch', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('POST /api/cloudsearch', { path: '/api/cloudsearch', method: 'POST', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('GET /api/search/pc', { path: '/api/search/pc', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('GET /api/search/hot', { path: '/api/search/hot', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('GET /api/search/get/mobile', { path: '/api/search/get/mobile', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('GET /api/song/search', { path: '/api/song/search', params: { s, type: 1, offset: 0, limit: 50 } });
    await call('GET /api/artist/songs', { path: '/api/artist/songs', params: { id: 6454, limit: 50, offset: 0 } });
    await call('GET /api/album/songs', { path: '/api/album/songs', params: { id: 2263172, limit: 50, offset: 0 } });
})();
