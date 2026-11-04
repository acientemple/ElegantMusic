const axios = require('axios');
(async () => {
    const res = await axios.get('https://music.163.com/api/search/get', {
        params: { s: '晴天', type: 1, offset: 0, limit: 100 },
        headers: { 'user-agent': 'Mozilla/5.0', cookie: 'os=pc; appver=2.9.7' },
    });
    const songs = res.data?.result?.songs || [];
    // 找 fee=1 的 VIP 歌
    const vip = songs.filter((s) => s.fee === 1).slice(0, 3);
    vip.forEach((s) => console.log(`VIP候选 id=${s.id} ${s.name} / ${(s.artists||[]).map(a=>a.name).join(',')} fee=${s.fee} dur=${s.duration}`));
    if (vip.length) {
        const p = await axios.get('https://music.163.com/api/song/enhance/player/url', {
            params: { ids: `[${vip[0].id}]`, br: 128000 },
            headers: { 'user-agent': 'Mozilla/5.0', cookie: 'os=pc; appver=2.9.7' },
        });
        const s = p.data?.data?.[0];
        console.log(`  -> player/url: fee=${s?.fee} time=${s?.time}ms size=${s?.size} url=${s?.url?'YES':'null'}`);
    }
})();
