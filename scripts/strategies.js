// 比较不同检索策略对「原唱 + 整轨候选」的召回率
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HOST = 'https://music.163.com';
const COOKIE = 'os=pc; appver=2.9.7';

async function get(path, params) {
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    try {
        const res = await fetch(url, {
            headers: {
                'user-agent': UA,
                referer: 'https://music.163.com/',
                origin: 'https://music.163.com',
                cookie: COOKIE,
            },
            signal: AbortSignal.timeout(15000),
        });
        return await res.json();
    } catch (e) {
        return { code: -1, msg: String(e.message || e) };
    }
}

function artistOf(s) {
    const a = s.ar || s.artists || [];
    return Array.isArray(a) ? a.map((x) => x?.name).filter(Boolean).join(' / ') : a?.name || '';
}
function durOf(s) {
    return Number(s.duration || s.dt || 0);
}

// 引擎1: /api/search/get   引擎2: /api/cloudsearch/pc   引擎3: /api/search/get/web
async function search(engine, q, limit = 100) {
    if (engine === 'mobile') {
        const d = await get('/api/search/get', { s: q, type: 1, offset: 0, limit });
        return d?.result?.songs || [];
    }
    if (engine === 'cloud') {
        const d = await get('/api/cloudsearch/pc', { s: q, type: 1, offset: 0, limit });
        return d?.result?.songs || [];
    }
    const d = await get('/api/search/get/web', { csrf_token: '', s: q, type: 1, offset: 0, limit, total: true });
    return d?.result?.songs || [];
}

async function playerUrl(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const d = await get('/api/song/enhance/player/url', { ids: JSON.stringify(chunk), br: 128000 });
        for (const item of d?.data || []) out.set(String(item.id), item);
    }
    return out;
}

// 整轨判定：优先用 source.time / 声明时长；兜底用 size / (dur * br/8)
function isFull(song, src) {
    if (!src?.url) return false;
    const dur = durOf(song);
    if (dur > 0 && src.time) return src.time / dur >= 0.9;
    if (!dur || !src.size || !src.br) return false;
    return src.size / (dur * (src.br / 8)) >= 0.5;
}

const CASES = [
    ['晴天', '周杰伦'],
    ['信仰', '张信哲'],
    ['夜曲', '周杰伦'],
    ['起风了', '买辣椒也用券'],
    ['海阔天空', 'Beyond'],
    ['遇见', '孙燕姿'],
    ['红玫瑰', '陈奕迅'],
    ['光年之外', '邓紫棋'],
    ['十年', '陈奕迅'],
    ['稻香', '周杰伦'],
];

(async () => {
    for (const [title, artist] of CASES) {
        const strategies = [
            ['A 仅歌名/mobile', 'mobile', title],
            ['B 歌名+歌手/mobile', 'mobile', `${title} ${artist}`],
            ['C 仅歌手/mobile', 'mobile', artist],
            ['D 仅歌名/cloud', 'cloud', title],
        ];
        const line = [];
        for (const [label, engine, q] of strategies) {
            const songs = await search(engine, q, 100);
            // 精确同名 + 同歌手 = 原唱
            const origin = songs.filter(
                (s) => s.name === title && artistOf(s).includes(artist),
            );
            const full = [];
            const usable = songs.filter((s) => s.id);
            const src = await playerUrl(usable.slice(0, 100).map((s) => s.id));
            for (const s of usable.slice(0, 100)) {
                if (isFull(s, src.get(String(s.id)))) full.push(s);
            }
            line.push(
                `${label}[命中${songs.length} 原唱${origin.length} 整轨${full.length}]`,
            );
            await new Promise((r) => setTimeout(r, 250));
        }
        console.log(`${title} - ${artist}\n    ${line.join('\n    ')}`);
    }
})();
