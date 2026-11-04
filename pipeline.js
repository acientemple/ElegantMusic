// 复现 full-track.js 的完整链路，量化每个环节的损耗
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HOST = 'https://music.163.com';
const COOKIE = 'os=pc; appver=2.9.7';
const CHECK_BR = 128000;
const BPS = CHECK_BR / 8;
const RATIO = 0.5;

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

const NOISE = ['伴奏','纯音乐','纯钢琴','纯器乐','间奏','前奏','尾奏','instrumental','karaoke','卡拉ok','铃声','ringtone','remix','mashup','sped up','slowed','reverb','piano version','piano cover','lofi','lo-fi','kidz bop','sing along','lullaby','nursery rhyme','meditation','sleep music'];

function isNoise(s) {
    const t = (String(s.name || '') + ' ' + String(s.al?.name || s.album?.name || '')).toLowerCase();
    return NOISE.some((m) => t.includes(m));
}

async function searchWeb(q, limit = 50) {
    const d = await get('/api/search/get/web', { csrf_token: '', s: q, type: 1, offset: 0, limit, total: true });
    if (d.code !== 200) return { err: `code=${d.code} msg=${d.msg}`, songs: [] };
    return { songs: d.result?.songs || [] };
}

async function playerUrl(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const d = await get('/api/song/enhance/player/url', { ids: JSON.stringify(chunk), br: CHECK_BR });
        for (const item of d?.data || []) out.set(String(item.id), item);
    }
    return out;
}

async function run(title, artist, originDuration) {
    const r = await searchWeb(title, 50);
    const songs = r.songs;
    const stage = [];
    stage.push(`搜索命中=${songs.length}${r.err ? ' (ERR ' + r.err + ')' : ''}`);
    if (!songs.length) {
        console.log(`✗ ${title} - ${artist} :: ${stage.join(' | ')}`);
        return;
    }
    const usable = songs.filter((s) => s.id && !isNoise(s));
    stage.push(`去噪后=${usable.length}`);
    const src = await playerUrl(usable.map((s) => s.id));
    let noUrl = 0, fee1 = 0, short = 0, full = 0;
    for (const s of usable) {
        const it = src.get(String(s.id));
        if (!it?.url) { noUrl++; continue; }
        if (it.fee === 1) { fee1++; continue; }
        const dur = Number(s.duration || 0) / 1000;
        if (dur <= 0) { short++; continue; }
        if (it.size / (dur * BPS) >= RATIO) full++;
        else short++;
    }
    stage.push(`无url=${noUrl} fee1=${fee1} 判定短=${short} 整轨=${full}`);
    console.log(`${full ? '✓' : '✗'} ${title} - ${artist} :: ${stage.join(' | ')}`);
}

(async () => {
    const cases = [
        ['信仰', '张信哲'],
        ['起风了', '买辣椒也用券'],
        ['夜曲', '周杰伦'],
        ['晴天', '周杰伦'],
        ['海阔天空', 'Beyond'],
        ['遇见', '孙燕姿'],
        ['shape of you', 'Ed Sheeran'],
        ['稻香', '周杰伦'],
        ['红玫瑰', '陈奕迅'],
        ['那些年', '胡夏'],
        ['突然的自我', '伍佰'],
        ['十年', '陈奕迅'],
        ['光年之外', '邓紫棋'],
        ['晴天 (Live)', '周杰伦'],
        ['Lemon', '米津玄师'],
    ];
    for (const [t, a] of cases) {
        await run(t, a);
        await new Promise((r) => setTimeout(r, 400));
    }
})();
