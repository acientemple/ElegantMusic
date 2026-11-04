const path = require('path');
// 在 Node 里跑插件逻辑：把 axios 换成 fetch 实现
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'axios') {
        return {
            get: async (url, config = {}) => {
                const u = new URL(url);
                Object.entries(config.params || {}).forEach(([k, v]) => {
                    if (v !== undefined && v !== null) {
                        u.searchParams.set(k, String(v));
                    }
                });
                const res = await fetch(u.toString(), {
                    headers: { 'User-Agent': 'Mozilla/5.0', ...(config.headers || {}) },
                    signal: AbortSignal.timeout(config.timeout || 8000),
                });
                const text = await res.text();
                let data;
                try { data = JSON.parse(text); } catch { data = text; }
                return { data, status: res.status };
            },
        };
    }
    return origLoad(request, parent, isMain);
};

global.env = { getUserVariables: () => ({}) };

const dir = path.resolve(__dirname, '../plugins') + path.sep;

function brief(lrc) {
    if (!lrc) return 'null';
    const lines = lrc.split(/\r?\n/).filter((l) => l.trim());
    return `lines=${lines.length} timed=${lines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length}`;
}

(async () => {
    for (const name of ['music-chart.js', 'hot-sheets.js', 'full-track.js']) {
        const plugin = require(dir + name);
        console.log(`\n===== ${name} (${plugin.platform} v${plugin.version}) =====`);
        console.log('primaryKey:', plugin.primaryKey);

        const cases = [
            ['网易云有歌词', { id: '186016', platform: plugin.platform, title: '晴天', artist: '周杰伦' }],
            ['网易云无歌词 -> 跨源兜底', { id: '999999999', platform: plugin.platform, title: '青花瓷', artist: '周杰伦' }],
            ['无歌名 -> 反查网易云详情', { id: '186016', platform: plugin.platform }],
            ['QQ+LRCLIB 都查不到', { id: '999999999', platform: plugin.platform, title: 'zzz不存在的歌zzz', artist: 'zzz' }],
        ];
        for (const [label, item] of cases) {
            const t = Date.now();
            try {
                const lyric = await plugin.getLyric(item);
                console.log(`  [${label}] ${Date.now() - t}ms ${brief(lyric.rawLrc)} trans=${brief(lyric.translation)}`);
                console.log(`     head: ${(lyric.rawLrc || '').split('\n').slice(0, 2).join(' / ').slice(0, 110)}`);
            } catch (e) {
                console.log(`  [${label}] 抛错: ${e.message}`);
            }
        }
    }
})();
