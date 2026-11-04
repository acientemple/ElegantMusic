const axios = require('axios');
const API = 'https://music.163.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const H = () => ({ 'user-agent': UA, referer: 'https://music.163.com/', origin: 'https://music.163.com', cookie: 'os=pc; appver=2.9.7' });
const req = async (path, params) => (await axios.get(API + path, { params, headers: H(), timeout: 15000 })).data;
const art = (s) => (s.ar || s.artists || []).map(a => a.name).join('/');
const dur = (s) => Math.round(Number(s.duration || s.dt || 0) / 1000);

const targets = [
    ['晴天', '周杰伦'],
    ['夜曲', '周杰伦'],
    ['十年', '陈奕迅'],
    ['信仰', '张信哲'],
];

(async () => {
    for (const [title, artist] of targets) {
        const data = await req('/api/search/get', { s: `${title} ${artist}`, type: 1, offset: 0, limit: 100 });
        const songs = data?.result?.songs || [];
        const hits = songs.filter(s => art(s).includes(artist));
        console.log(`\n===== ${title} - ${artist} ===== 命中 ${songs.length} 首，其中 ${hits.length} 首署名该歌手`);
        for (const s of hits.slice(0, 8)) {
            const pu = await req('/api/song/enhance/player/url', { ids: '[' + s.id + ']', br: 128000 });
            const src = (pu?.data || [])[0];
            const playable = src?.time ? Math.round(src.time / 1000) : 0;
            const ok = src?.url && playable >= dur(s) * 0.9 ? '整轨' : '试听/不可用';
            console.log(`  id=${s.id} | ${s.name} | ${dur(s)}s | fee=${src?.fee} | 可播=${playable}s | ${ok}`);
        }
    }
})();
