// 探测 player/url 返回结构，以及 VIP / 免费歌曲的差异
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
        signal: AbortSignal.timeout(15000),
    });
    return res.json();
}

function dump(label, obj) {
    console.log(
        `  ${label}: id=${obj.id} fee=${obj.fee} br=${obj.br} size=${obj.size} time=${obj.time} url=${obj.url ? 'YES' : 'null'}`,
    );
}

(async () => {
    // 用 /api/search/get 找到一批不同版权状态的歌
    const d = await get('/api/search/get', { s: '晴天 周杰伦', type: 1, offset: 0, limit: 10 });
    const songs = d?.result?.songs || [];
    console.log('=== 搜索到的歌 ===');
    songs.forEach((s) =>
        console.log(
            `  id=${s.id} ${s.name} / ${(s.artists || []).map((a) => a.name).join(',')} fee=${s.fee} dur=${s.duration}`,
        ),
    );

    const ids = songs.map((s) => s.id);
    console.log('\n=== player/url (br=128000) ===');
    const p = await get('/api/song/enhance/player/url', { ids: JSON.stringify(ids), br: 128000 });
    (p?.data || []).forEach((x) => dump('song', x));

    console.log('\n=== player/url (br=320000) ===');
    const p2 = await get('/api/song/enhance/player/url', { ids: JSON.stringify(ids), br: 320000 });
    (p2?.data || []).forEach((x) => dump('song', x));

    console.log('\n=== player/url 完整返回（第一个）===');
    console.log(JSON.stringify(p?.data?.[0], null, 2));
})();
