const path = require('path');
const fs = require('fs');
global.env = { getUserVariables: () => ({}) };
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(
    path.resolve(__dirname, '../plugins/full-track.js'),
    localCopy,
);
const plugin = require(localCopy);

const NOISE = ['伴奏', '纯音乐', '钢琴', '咚鼓', '鼓版', 'DJ', 'remix', 'karaoke', ' instrumental', '加速', '慢速', '变速', '童谣', '儿歌', 'nightcore', '八度', '吉他版', '二胡版', '古筝版'];

(async () => {
    for (const [title, artist, duration] of [
        ['信仰', '张信哲', 256],
        ['晴天', '周杰伦', 269],
    ]) {
        const data = (await plugin.getMusicAlternatives({ id: '0', platform: 't', title, artist, duration }, 1))?.data || [];
        const bad = data.filter((x) => NOISE.some((m) => (x.title || '').toLowerCase().includes(m.toLowerCase())));
        console.log(`\n${title} - ${artist}: ${data.length} 条，噪声版本 ${bad.length} 条`);
        bad.forEach((x) => console.log('  ✗ 漏网: ' + x.title + ' / ' + x.artist));
        console.log('  全部:');
        data.forEach((x, i) => console.log(`   ${i + 1}. ${x.title} / ${x.artist}${x.isOriginArtist ? ' [原唱]' : ''}`));
    }
})();
