// 排序回归测试：原唱版本必须排在翻唱之前
const path = require('path');
const fs = require('fs');

global.env = { getUserVariables: () => ({}) };

const PLUGIN_PATH =
    process.env.PLUGIN_PATH ||
    'C:/Users/Lenovo/AppData/Roaming/MusicFree/musicfree-plugins/full-track.js';
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(path.resolve(PLUGIN_PATH), localCopy);
const plugin = require(localCopy);

function fmt(d) {
    return `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;
}

const cases = [
    // 网易云上原唱写成 I Do It For You（大写 F），原曲是 I Do It for You
    ['(Everything I Do) I Do It for You', 'Bryan Adams', 396],
    ['信仰', '张信哲', 256],
    ['晴天', '周杰伦', 269],
    ['夜曲', '周杰伦', 224],
    ['十年', '陈奕迅', 192],
    ['海阔天空', 'Beyond', 320],
    ['遇见', '孙燕姿', 209],
];

(async () => {
    for (const [title, artist, duration] of cases) {
        const origin = { id: '0', platform: 'test', title, artist, duration };
        const t0 = Date.now();
        let data = [];
        try {
            data = (await plugin.getMusicAlternatives(origin, 1))?.data || [];
        } catch (e) {
            console.log(`✗ ${title} - ${artist} :: 抛错 ${e.message}`);
            continue;
        }
        const top = data[0];
        const topIsOrigin = top?.isOriginArtist === true;
        const originCount = data.filter((x) => x.isOriginArtist).length;
        console.log(
            `${data.length && topIsOrigin ? '✓' : '✗'} ${title} - ${artist} :: 候选=${data.length} 原唱=${originCount} 首位=${topIsOrigin ? '原唱' : '非原唱'} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        data.slice(0, 5).forEach((x, i) => {
            console.log(
                `      ${i + 1}. ${x.title} / ${x.artist} / ${fmt(x.duration || 0)}${x.isOriginArtist ? ' [原唱]' : ''}`,
            );
        });
    }
})();
