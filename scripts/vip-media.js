const path = require('path'); const fs = require('fs');
global.env = { getUserVariables: () => ({}) };
const localCopy = path.join(__dirname, '_plugin_under_test.js');
fs.copyFileSync(path.resolve(__dirname, '../plugins/full-track.js'), localCopy);
const plugin = require(localCopy);
(async () => {
    const vipItem = { id: '1945894789', duration: 238 };   // VIP 试听歌
    try {
        await plugin.getMediaSource(vipItem, 'standard');
        console.log('✗ VIP 试听歌未被拦截（应当报错）');
    } catch (e) {
        console.log(`✓ VIP 试听歌被拦截：${e.message}`);
    }
    try {
        const s = await plugin.getMediaSource({ id: '1945894789' }, 'standard');
        console.log(`? 未声明时长时放行: ${s.url.slice(0,50)}...`);
    } catch (e) {
        console.log(`? 未声明时长: ${e.message}`);
    }
})();
