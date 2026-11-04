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

const plugin = require(path.resolve(__dirname, '../plugins/lyric-source.js'));

function brief(lrc) {
    if (!lrc) return 'null';
    const lines = lrc.split(/\r?\n/).filter((l) => l.trim());
    return `lines=${lines.length} timed=${lines.filter((l) => /\[\d{1,3}:\d{1,2}/.test(l)).length}`;
}

(async () => {
    console.log('platform:', plugin.platform, '| supported:', plugin.supportedSearchType, '| primaryKey:', plugin.primaryKey);

    for (const q of ['青花瓷', 'Shape of You']) {
        console.log(`\n===== search: ${q} =====`);
        const t0 = Date.now();
        const res = await plugin.search(q, 1, 'lyric');
        console.log('耗时', Date.now() - t0, 'ms, 结果', res.data.length, '条, isEnd=', res.isEnd);
        res.data.slice(0, 8).forEach((it) => {
            console.log(`  ${it.id} | ${it.title} | ${it.artist} | ${it.duration}s | ${it.lyricKey}`);
        });
        if (!res.data.length) continue;

        console.log(`  -- getLyric 前 3 条 --`);
        for (const it of res.data.slice(0, 3)) {
            const t1 = Date.now();
            const lyric = await plugin.getLyric(it);
            console.log(`   ${it.title} / ${it.artist}: ${brief(lyric.rawLrc)} trans=${brief(lyric.translation)} (${Date.now() - t1}ms)`);
            console.log(`     head: ${(lyric.rawLrc || '').split('\n').slice(0, 2).join(' / ')}`);
        }
    }
})();
