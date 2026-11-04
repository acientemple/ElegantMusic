// 独立测试 full-track.js：mock env 后加载插件，验证各方法
const path = require('path');
const fs = require('fs');

global.env = {
    getUserVariables: () => ({}),
};

const PLUGIN_PATH =
    process.env.PLUGIN_PATH ||
    path.resolve(__dirname, '../plugins/full-track.js');
// 复制到测试目录，让 require('axios') 命中测试用的 shim
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(path.resolve(PLUGIN_PATH), localCopy);
const plugin = require(localCopy);

function fmt(duration) {
    const m = Math.floor(duration / 60);
    const s = Math.floor(duration % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

async function testAlternatives(title, artist, duration) {
    const origin = { id: '0', platform: 'test', title, artist, duration };
    const t0 = Date.now();
    let result;
    try {
        result = await plugin.getMusicAlternatives(origin, 1);
    } catch (e) {
        console.log(`✗ ${title} - ${artist} :: 抛错 ${e.message}`);
        return;
    }
    const data = result?.data || [];
    const originCount = data.filter((x) => x.isOriginArtist).length;
    console.log(
        `${data.length ? '✓' : '✗'} ${title} - ${artist} :: 候选=${data.length} 原唱=${originCount} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    data.slice(0, 4).forEach((x) => {
        console.log(
            `      · ${x.title} / ${x.artist} / ${fmt(x.duration || 0)}${x.isOriginArtist ? ' [原唱]' : ''}`,
        );
    });
}

async function testSearch(query) {
    const t0 = Date.now();
    try {
        const r = await plugin.search(query, 1, 'music');
        console.log(
            `✓ search("${query}") => ${r.data?.length} 条整轨, isEnd=${r.isEnd}, 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        (r.data || []).slice(0, 3).forEach((x) =>
            console.log(`      · ${x.title} / ${x.artist} / ${fmt(x.duration || 0)}`),
        );
    } catch (e) {
        console.log(`✗ search("${query}") 抛错 ${e.message}`);
    }
}

(async () => {
    console.log('=== search ===');
    await testSearch('信仰');
    await testSearch('晴天');
    await testSearch('海阔天空');

    console.log('\n=== getMusicAlternatives ===');
    const cases = [
        ['信仰', '张信哲', 256],
        ['晴天', '周杰伦', 269],
        ['夜曲', '周杰伦', 224],
        ['稻香', '周杰伦', 223],
        ['起风了', '买辣椒也用券', 329],
        ['海阔天空', 'Beyond', 320],
        ['遇见', '孙燕姿', 209],
        ['红玫瑰', '陈奕迅', 258],
        ['十年', '陈奕迅', 192],
        ['光年之外', '邓紫棋', 235],
        ['信仰 (Live)', '张信哲', 256],
    ];
    for (const [t, a, d] of cases) {
        await testAlternatives(t, a, d);
    }
})();
