const axios = require('axios');
const API = 'https://music.163.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const H = () => ({
    'user-agent': UA,
    referer: 'https://music.163.com/',
    origin: 'https://music.163.com',
    cookie: 'os=pc; appver=2.9.7',
});
const req = async (path, params) => (await axios.get(API + path, { params, headers: H(), timeout: 15000 })).data;

(async () => {
    const q = '(Everything I Do) I Do It for You Bryan Adams';
    const data = await req('/api/search/get', { s: q, type: 1, offset: 0, limit: 100 });
    const songs = data?.result?.songs || [];
    console.log('搜索命中 ' + songs.length + ' 首, songCount=' + data?.result?.songCount);
    const art = (s) => (s.ar || s.artists || []).map(a => a.name).join('/');
    const dur = (s) => Math.round(Number(s.duration || s.dt || 0) / 1000);

    // 找出所有 Bryan Adams 相关的
    const hits = songs.filter(s => /bryan adams/i.test(art(s)) || /bryan adams/i.test(s.name));
    console.log('\n--- Bryan Adams 相关命中 ---');
    for (const s of hits.slice(0, 12)) {
        const pu = await req('/api/song/enhance/player/url', { ids: '[' + s.id + ']', br: 128000 });
        const src = (pu?.data || [])[0];
        console.log(
            `id=${s.id} | ${s.name} | ${art(s)} | 声明时长=${dur(s)}s | fee=${src?.fee} | 可播时长=${src?.time ? Math.round(src.time/1000) : '无'}s | url=${src?.url ? '有' : '无'} | size=${src?.size}`,
        );
    }
    console.log('\n--- 前 5 名原样 ---');
    songs.slice(0, 5).forEach((s, i) =>
        console.log(`${i}. [${dur(s)}s] ${s.name} — ${art(s)} (id=${s.id})`),
    );
})();
