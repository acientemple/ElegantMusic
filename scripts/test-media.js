// 验证 getMediaSource 的整轨/试听判定
const path = require('path');
const fs = require('fs');

global.env = { getUserVariables: () => ({}) };

const PLUGIN_PATH =
    process.env.PLUGIN_PATH ||
    path.resolve(__dirname, '../plugins/full-track.js');
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(path.resolve(PLUGIN_PATH), localCopy);
const plugin = require(localCopy);

const axios = require('axios');

async function findSong(query, wantArtist) {
    const res = await axios.get('https://music.163.com/api/search/get', {
        params: { s: query, type: 1, offset: 0, limit: 100 },
        headers: { 'user-agent': 'Mozilla/5.0', cookie: 'os=pc; appver=2.9.7' },
    });
    const songs = res.data?.result?.songs || [];
    return songs.find((s) => {
        const names = (s.artists || []).map((a) => a.name);
        return names.some((n) => wantArtist && n.includes(wantArtist));
    });
}

async function check(label, item) {
    try {
        const src = await plugin.getMediaSource(item, 'standard');
        console.log(`✓ ${label} => 拿到音源 ${src.url.slice(0, 60)}...`);
    } catch (e) {
        console.log(`✗ ${label} => ${e.message}`);
    }
}

(async () => {
    // 免费整轨
    const free = await findSong('信仰 张信哲', '张信哲');
    if (free) {
        await check(
            `免费整轨 ${free.name}/${free.artists[0].name} (声明${free.duration / 1000}s)`,
            { id: free.id, duration: Math.round(free.duration / 1000) },
        );
    }

    // VIP 试听（未登录）
    const vip = await findSong('晴天 周杰伦', '周杰伦');
    if (vip) {
        await check(
            `VIP未登录 ${vip.name}/${vip.artists[0].name} (声明${vip.duration / 1000}s)`,
            { id: vip.id, duration: Math.round(vip.duration / 1000) },
        );
        // 模拟登录用户：同一条目但 duration 未知时不应被误拒
        await check(`  同上但未声明时长`, { id: vip.id });
    }

    // 试听片段的真实可播时长
    if (vip) {
        const res = await axios.get('https://music.163.com/api/song/enhance/player/url', {
            params: { ids: `[${vip.id}]`, br: 128000 },
            headers: { 'user-agent': 'Mozilla/5.0', cookie: 'os=pc; appver=2.9.7' },
        });
        const s = res.data?.data?.[0];
        console.log(
            `  播放地址返回: fee=${s?.fee} time=${s?.time}ms size=${s?.size} url=${s?.url ? 'YES' : 'null'}`,
        );
    }
})();
