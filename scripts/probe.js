// 探测网易云各搜索接口的真实行为
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HOST = 'https://music.163.com';

const CLIENT_COOKIE = { os: 'pc', appver: '2.9.7' };

function buildCookie(extra = '') {
    const map = new Map();
    const raw = (extra + '; ' + Object.entries(CLIENT_COOKIE).map(([k, v]) => `${k}=${v}`).join('; '));
    raw.split(';').forEach((p) => {
        const t = p.trim();
        if (!t) return;
        const i = t.indexOf('=');
        if (i > 0) map.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
    });
    return Array.from(map.entries()).map((e) => `${e[0]}=${e[1]}`).join('; ');
}

async function get(path, params, extraCookie = '') {
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries(params || {})) {
        url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
        headers: {
            'user-agent': UA,
            referer: 'https://music.163.com/',
            origin: 'https://music.163.com',
            cookie: buildCookie(extraCookie),
        },
    });
    const text = await res.text();
    try {
        return { status: res.status, json: JSON.parse(text) };
    } catch (e) {
        return { status: res.status, text: text.slice(0, 300) };
    }
}

function describe(name, r) {
    if (!r.json) {
        console.log(`  [${name}] status=${r.status} 非JSON: ${r.text}`);
        return;
    }
    const j = r.json;
    if (j.code !== undefined && j.code !== 200) {
        console.log(`  [${name}] status=${r.status} code=${j.code} msg=${j.msg}`);
        return;
    }
    const result = j.result || {};
    const songs = result.songs || [];
    console.log(
        `  [${name}] status=${r.status} code=${j.code} songCount=${result.songCount} songs=${songs.length}`,
    );
    songs.slice(0, 3).forEach((s) => {
        console.log(
            `      - ${s.name} / ${(s.ar || []).map((a) => a.name).join(',')} / ${s.duration}ms / id=${s.id}`,
        );
    });
}

(async () => {
    const q = process.argv[2] || '信仰';
    const limit = process.argv[3] || '50';
    console.log(`=== 查询: ${q} (limit=${limit}) ===`);

    console.log('\n1) /api/search/get/web  (当前插件使用)');
    const web = await get('/api/search/get/web', {
        csrf_token: '',
        s: q,
        type: 1,
        offset: 0,
        limit,
        total: true,
    });
    describe('web', web);

    console.log('\n2) /api/search/get  (移动端风格)');
    const mob = await get('/api/search/get', {
        s: q,
        type: 1,
        offset: 0,
        limit,
    });
    describe('get', mob);

    console.log('\n3) /api/cloudsearch/pc  (云搜索)');
    const cloud = await get('/api/cloudsearch/pc', {
        s: q,
        type: 1,
        offset: 0,
        limit,
    });
    describe('cloudsearch', cloud);

    console.log('\n4) /api/search/pc');
    const pc = await get('/api/search/pc', {
        s: q,
        type: 1,
        offset: 0,
        limit,
    });
    describe('search/pc', pc);

    console.log('\n5) /api/search/pc 上限测试 (limit=100)');
    const pc100 = await get('/api/search/pc', {
        s: q,
        type: 1,
        offset: 0,
        limit: 100,
    });
    describe('search/pc100', pc100);
})();
