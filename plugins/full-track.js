/**
 * 完整版搜索 —— 网易云音乐聚合插件
 *
 * 解决的问题：网易云上不少歌曲是 VIP，不登录只能拿到 30 秒左右的试听片段。
 * 本插件做两件事：
 *   1. 搜索时只吐出能整轨播放的歌曲 —— 用接口实际返回的可播时长校验；
 *   2. 提供 getMusicAlternatives，给应用内「搜索完整播放版本」入口用：
 *      按歌名/歌手搜出同一首歌的其他版本，同样只保留整轨可播的候选。
 *
 * 平台标识：完整版搜索
 */

const axios = require('axios');

const PLATFORM = '完整版搜索';
const API_HOST = 'https://music.163.com';

const SEARCH_PAGE_SIZE = 30;
const ALTERNATIVE_LIMIT = 20;
// 网易云搜索单次最多返回 100 条
const CANDIDATE_LIMIT = 100;
// 播放地址接口一次最多稳妥处理 25 个 id
const ID_CHUNK_SIZE = 25;

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 网易云 Web 接口在缺少客户端标识时只吐出 10 首歌，
// 带上 os / appver 才会返回完整结果。
const CLIENT_COOKIE = { os: 'pc', appver: '2.9.7' };

const QUALITY_BITRATE = {
    low: 64000,
    standard: 128000,
    high: 320000,
    super: 999000,
};

// 校验长度时统一按 128k 折算
const CHECK_BR = 128000;
const CHECK_BYTES_PER_SEC = CHECK_BR / 8;

// 整轨的音频长度至少要达到理论值的这个比例。
// 实测整轨约 1.00，试听片段约 0.10~0.19，两者区分得很开。
const FULL_LENGTH_RATIO = 0.5;
// 播放地址接口直接给出实际可播时长（毫秒），与歌曲声明时长相比更可靠。
// 试听片段只有原曲的一成左右，这里取 0.9 留出编码误差余量。
const FULL_TIME_RATIO = 0.9;
// 候选时长至少要达到原曲的这个比例才算这首歌的完整版，
// 否则几十秒的片段会混进来。
const MIN_DURATION_RATIO = 0.5;

// 伴奏、改编、加速慢速、儿童/冥想类衍生录音都不算「同一首歌的完整版」。
// 这些噪音版本往往时长也接近原曲，光靠长度筛选会把它们排到前面。
const NOISE_MARKERS = [
    '伴奏',
    '纯音乐',
    '纯钢琴',
    '钢琴版',
    '钢琴曲',
    '纯器乐',
    '间奏',
    '前奏',
    '尾奏',
    'instrumental',
    'karaoke',
    '卡拉ok',
    '铃声',
    'ringtone',
    'remix',
    'mashup',
    'sped up',
    'slowed',
    'reverb',
    '咚鼓',
    '鼓版',
    '加速版',
    '慢速版',
    '变速',
    'nightcore',
    '八度',
    '童谣',
    '儿歌',
    '吉他版',
    '古筝版',
    '二胡版',
    'piano version',
    'piano cover',
    'lofi',
    'lo-fi',
    'kidz bop',
    'sing along',
    'lullaby',
    'nursery rhyme',
    'meditation',
    'sleep music',
    'dj版',
    'dub版',
    '萨克斯版',
    '小提琴版',
    '大提琴版',
    '琵琶版',
    '弦乐版',
    '管弦版',
    '交响版',
    '电音版',
];

// 格式信息藏在歌手名里的情况（「信仰 / DJ阿哲」），只看歌名会漏掉
const NOISE_ARTIST_MARKERS = [
    /伴奏/,
    /纯音乐/,
    /instrumental/,
    /(?:^|[^a-z])dj/,
    /remix/,
    /铃声/,
    /ringtone/,
];

// 多个搜索引擎互为备份：网易云对单个接口的风控是独立的，
// 一个被拦（405 操作频繁 / -462）时其余的仍然能返回结果。
// search/get 与 cloudsearch/pc 实测稳定，放在前面；
// search/pc 与 search/get/web 波动大，只在前面全部失败时兜底。
const SEARCH_ENGINES = [
    {
        name: 'search/get',
        path: '/api/search/get',
        params: (query, limit, offset) => ({
            s: query,
            type: 1,
            offset,
            limit,
        }),
    },
    {
        name: 'cloudsearch/pc',
        path: '/api/cloudsearch/pc',
        params: (query, limit, offset) => ({
            s: query,
            type: 1,
            offset,
            limit,
        }),
    },
];

const FALLBACK_SEARCH_ENGINES = [
    {
        name: 'search/pc',
        path: '/api/search/pc',
        params: (query, limit, offset) => ({
            s: query,
            type: 1,
            offset,
            limit,
        }),
    },
    {
        name: 'search/get/web',
        path: '/api/search/get/web',
        params: (query, limit, offset) => ({
            csrf_token: '',
            s: query,
            type: 1,
            offset,
            limit,
            total: true,
        }),
    },
];

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无歌词';


/* ---------------------------- 跨源歌词兜底 ---------------------------- */

// 网易云没有收录这首歌、或这首歌没有歌词时，改从 QQ 音乐与 LRCLIB 取词
const FALLBACK_TIMEOUT = 6000;
/** LRCLIB 常年不稳定，给它更短的超时，别拖累整体取词速度 */
const LRCLIB_TIMEOUT = 3000;

// 归一化歌名 / 歌手：去掉大小写、空白与标点
function fallbackKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s·・\-_~,，。!！?？'"“”]/g, '');
}

// 去掉括号里的修饰（Live / DJ版 / 官方版…）
function fallbackLooseKey(text) {
    return fallbackKey(text).replace(/[（(\[【《][^）)\]】》]*[）)\]】》]/g, '');
}

/** 带时间轴的行数，带时间轴的歌词才用得上 */
function countLyricTimedLines(lrc) {
    return String(lrc || '')
        .split(/\r?\n/)
        .filter((line) => /\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/.test(line))
        .length;
}

/** 至少两行带时间轴、且不是「暂无歌词」才算有用的歌词 */
function isUsableLyric(lrc) {
    if (countLyricTimedLines(lrc) < 2) {
        return false;
    }
    return !/暂无(歌词|字幕)|歌词不存在|no\s*lyrics?/i.test(lrc);
}

/** 歌名与歌手都对得上才算命中，歌名完全一致优先于带修饰的版本 */
function songMatchScore(candidateTitle, candidateArtist, title, artist) {
    const ct = fallbackKey(candidateTitle);
    const nt = fallbackKey(title);
    if (!ct || !nt) {
        return 0;
    }
    let score = 0;
    if (ct === nt) {
        score += 4;
    } else if (fallbackLooseKey(candidateTitle) === fallbackLooseKey(title)) {
        score += 3;
    } else if (fallbackLooseKey(candidateTitle).includes(fallbackLooseKey(title))) {
        score += 1;
    }
    const ca = fallbackKey(candidateArtist);
    const na = fallbackKey(artist);
    if (na && ca) {
        if (ca === na) {
            score += 3;
        } else if (ca.includes(na) || na.includes(ca)) {
            score += 2;
        }
    }
    return score;
}

async function fallbackGet(url, params, headers, timeout) {
    const response = await axios.get(url, {
        params: params || {},
        headers: { 'user-agent': USER_AGENT, ...(headers || {}) },
        timeout: timeout || FALLBACK_TIMEOUT,
    });
    return response.data;
}

/** 在 QQ 音乐里按歌名找原唱并取回歌词 */
async function fetchQQLyricByName(title, artist) {
    const query = [title, artist].filter(Boolean).join(' ').trim();
    if (!query) {
        return [];
    }
    const data = await fallbackGet(
        'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
        { p: 1, n: 10, w: query, format: 'json' },
        { referer: 'https://y.qq.com/' },
    );
    const list = (data && data.data && data.data.song && data.data.song.list) || [];
    const ranked = list
        .map((song) => {
            const singer = (song.singer || [])
                .map((item) => item && item.name)
                .filter(Boolean)
                .join(' / ');
            return {
                songmid: song.songmid,
                score: songMatchScore(song.songname || '', singer, title, artist),
            };
        })
        .filter((item) => item.songmid)
        .sort((a, b) => b.score - a.score);
    const results = [];
    for (const item of ranked.slice(0, 2)) {
        // 歌名与歌手都对不上的候选直接跳过
        if (item.score < 4) {
            break;
        }
        try {
            const lyric = await fallbackGet(
                'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
                { songmid: item.songmid, format: 'json', nobase64: 1, g_tk: 5381 },
                { referer: 'https://y.qq.com/' },
            );
            if (Number(lyric && lyric.code) === 0 && lyric && lyric.lyric) {
                results.push({
                    rawLrc: lyric.lyric,
                    translation: lyric.trans || '',
                    match: item.score,
                });
            }
        } catch (e) {
            // 这条取不到就试下一条
        }
    }
    return results;
}

/** LRCLIB 只能按「歌名 + 歌手」取词 */
async function fetchLrclibLyricByName(title, artist) {
    if (!title) {
        return [];
    }
    try {
        const data = await fallbackGet(
            'https://lrclib.net/api/get',
            { track_name: title, artist_name: artist || '' },
            { referer: 'https://lrclib.net/' },
            LRCLIB_TIMEOUT,
        );
        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        if (rawLrc) {
            // 按歌名与歌手精确取回的，匹配度按满计算
            return [{ rawLrc, translation: '', match: 7 }];
        }
    } catch (e) {
        // 取不到就当没有
    }
    return [];
}

/** 歌词里出现大量非常用字符，说明这份歌词的编码不对 */
function garbledRatio(lrc) {
    const chars = String(lrc || '').replace(/\s/g, '');
    if (!chars) {
        return 0;
    }
    let bad = 0;
    for (const ch of chars) {
        const code = ch.codePointAt(0);
        const normal =
            code < 128 ||
            (code >= 0x4e00 && code <= 0x9fff) ||
            (code >= 0x3000 && code <= 0x303f) ||
            (code >= 0xff00 && code <= 0xffef) ||
            (code >= 0x2010 && code <= 0x206f);
        if (!normal) {
            bad += 1;
        }
    }
    return bad / chars.length;
}

/** 去掉 [ti:] [ar:] 这类头部信息，坏编码时它们会显示成乱码 */
function cleanLyricHeader(lrc) {
    return String(lrc || '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*\[(ti|ar|al|by)\s*:/i.test(line))
        .join('\n');
}

/**
 * 挑一份最好的歌词：
 * 先看是不是同一首歌（匹配度），再看歌词本身是否完整。
 * 只按行数挑会选到 DJ 版、变速版这类行数更多却不是原版的歌词
 */
function pickBestLyric(list) {
    let best = null;
    let bestScore = -1;
    (list || []).forEach((item) => {
        if (!item || !isUsableLyric(item.rawLrc)) {
            return;
        }
        let score = (item.match || 0) * 100;
        score += Math.min(countLyricTimedLines(item.rawLrc), 60);
        if (item.translation && item.translation.trim()) {
            score += 25;
        }
        score -= Math.round(garbledRatio(item.rawLrc) * 100);
        if (score > bestScore) {
            bestScore = score;
            best = {
                rawLrc: cleanLyricHeader(item.rawLrc),
                translation: item.translation || '',
            };
        }
    });
    return best;
}

/** 网易云没有歌词时的跨源兜底：先用 QQ，QQ 没有再用 LRCLIB */
async function fetchFallbackLyric(title, artist) {
    if (!title) {
        return null;
    }
    const qqResults = await fetchQQLyricByName(title, artist).catch(() => []);
    const fromQQ = pickBestLyric(qqResults);
    if (fromQQ) {
        return fromQQ;
    }
    const lrclibResults = await fetchLrclibLyricByName(title, artist).catch(() => []);
    return pickBestLyric(lrclibResults);
}

/** 关联歌词后拿不到歌名时，用网易云的详情接口反查 */
async function resolveSongName(musicItem) {
    let title = String((musicItem && musicItem.title) || '').trim();
    let artist = String((musicItem && musicItem.artist) || '').trim();
    if ((title && artist) || !(musicItem && musicItem.id)) {
        return { title, artist };
    }
    try {
        const data = await request('/api/song/detail', {
            ids: '[' + musicItem.id + ']',
        });
        const song = (data && data.songs && data.songs[0]) || null;
        if (song) {
            title = title || song.name || '';
            artist = artist || pickArtistName(song);
        }
    } catch (e) {
        // 反查不到就用现有信息
    }
    return { title, artist };
}

function toHttps(url) {
    return typeof url === 'string' ? url.replace(/^http:\/\//, 'https://') : url;
}

function getUserVariables() {
    try {
        return env.getUserVariables() || {};
    } catch (e) {
        return {};
    }
}

function buildCookie() {
    const raw = String(getUserVariables().cookie || '').trim();
    const map = new Map();
    raw.split(';').forEach((part) => {
        const text = part.trim();
        if (!text) {
            return;
        }
        const index = text.indexOf('=');
        if (index > 0) {
            map.set(text.slice(0, index).trim(), text.slice(index + 1).trim());
        }
    });
    Object.keys(CLIENT_COOKIE).forEach((key) => {
        if (!map.has(key)) {
            map.set(key, CLIENT_COOKIE[key]);
        }
    });
    return Array.from(map.entries())
        .map((entry) => `${entry[0]}=${entry[1]}`)
        .join('; ');
}

function buildHeaders() {
    return {
        'user-agent': USER_AGENT,
        referer: 'https://music.163.com/',
        origin: 'https://music.163.com',
        cookie: buildCookie(),
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
    };
}

async function request(path, params) {
    const response = await axios.get(API_HOST + path, {
        params: params || {},
        headers: buildHeaders(),
        timeout: 15000,
    });
    return response.data;
}

// 各引擎返回的字段名不一致，search/get 用 artists/album/duration，
// cloudsearch 用 ar/al/dt，这里统一成一套读取器。
function songArtists(song) {
    const list = song?.ar || song?.artists || [];
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item) => (typeof item === 'string' ? item : item?.name))
        .filter(Boolean);
}

function songAlbum(song) {
    return song?.al || song?.album || {};
}

function songDurationMs(song) {
    return Number(song?.duration || song?.dt || 0);
}

function songCover(song) {
    const album = songAlbum(song);
    return toHttps(album.picUrl || album.blurPicUrl || '');
}

function pickArtistName(song) {
    return songArtists(song).join(' / ');
}

function toMusicItem(song) {
    if (!song || !song.id) {
        return null;
    }
    const album = songAlbum(song);
    return {
        id: String(song.id),
        platform: PLATFORM,
        title: song.name || '未知歌曲',
        artist: pickArtistName(song) || '未知歌手',
        album: album.name || '',
        artwork: songCover(song),
        duration: Math.round(songDurationMs(song) / 1000),
    };
}

function isNoiseVersion(song) {
    const title = String(song?.name || '').toLowerCase();
    if (NOISE_MARKERS.some((marker) => title.includes(marker))) {
        return true;
    }
    const artist = pickArtistName(song).toLowerCase();
    return NOISE_ARTIST_MARKERS.some((marker) => marker.test(artist));
}

// 归一化歌名：去掉括号内的修饰（Live/Remastered/伴奏…）与分隔符，
// 用来比较「是不是同一首歌」。
function normalizeTitle(text) {
    return String(text || '')
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
        .replace(/[\s\-–—_·、,，.。!！?？'"“”‘’]+/g, '')
        .toLowerCase()
        .trim();
}

// 把歌名里的修饰成分剥掉，得到「干净歌名」，用它去搜更容易命中原版。
function stripDecoration(title) {
    const cleaned = String(title || '')
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || String(title || '').trim();
}

function titleMatches(originTitle, songName) {
    const origin = normalizeTitle(originTitle);
    const candidate = normalizeTitle(songName);
    if (!origin || !candidate) {
        return false;
    }
    if (origin === candidate) {
        return true;
    }
    if (origin.length < 2 || candidate.length < 2) {
        return false;
    }
    // 只认「候选以原歌名开头」这一种扩展（Live、原唱 XXX、DJ…），
    // 双向包含会把「时光倒流二十年」误当成「十年」。
    return candidate.startsWith(origin);
}

// 候选与原曲歌手的关系：2=完全同名，1=一方包含另一方，0=无关
function artistMatchLevel(song, origin) {
    const artists = songArtists(song);
    const originArtist = String(origin?.artist || '').trim();
    if (!artists.length || !originArtist) {
        return 0;
    }
    const target = originArtist.toLowerCase();
    if (artists.some((name) => name.trim().toLowerCase() === target)) {
        return 2;
    }
    const hit = artists.some(
        (name) =>
            name.includes(originArtist) ||
            (name.length >= 2 && originArtist.includes(name)),
    );
    return hit ? 1 : 0;
}

// 候选与原曲是否出自同一位歌手
function isSameArtist(song, origin) {
    return artistMatchLevel(song, origin) > 0;
}

// 单个引擎的一次检索。区分「引擎被拦」与「确实没有匹配」：
// 前者要换引擎，后者是正常的空结果。
async function searchByEngine(engine, query, limit, offset) {
    try {
        const data = await request(engine.path, engine.params(query, limit, offset));
        const songs = data?.result?.songs;
        if (!Array.isArray(songs)) {
            return {
                ok: false,
                engine: engine.name,
                message: data?.msg || `code=${data?.code}`,
            };
        }
        return { ok: true, engine: engine.name, songs, total: Number(data?.result?.songCount) || 0 };
    } catch (e) {
        return { ok: false, engine: engine.name, message: e?.message || String(e) };
    }
}

// 合并两个引擎的同一首歌：各引擎字段名不同，缺什么补什么。
function mergeSong(base, extra) {
    const merged = { ...base };
    Object.keys(extra).forEach((key) => {
        if (merged[key] === undefined) {
            merged[key] = extra[key];
        }
    });
    return merged;
}

// 多引擎检索：先并行打前排引擎，全部失败再退到兜底引擎。
async function searchMulti(query, limit, offset = 0) {
    const merged = new Map();
    const errors = [];
    let primaryOk = 0;
    let total = 0;

    const collect = (songs) => {
        for (const song of songs) {
            if (!song?.id) {
                continue;
            }
            const id = String(song.id);
            const previous = merged.get(id);
            merged.set(id, previous ? mergeSong(previous, song) : song);
        }
    };

    const primary = await Promise.all(
        SEARCH_ENGINES.map((engine) => searchByEngine(engine, query, limit, offset)),
    );
    for (const result of primary) {
        if (!result.ok) {
            errors.push(`${result.engine}: ${result.message}`);
            continue;
        }
        primaryOk += 1;
        total = Math.max(total, result.total || 0);
        collect(result.songs);
    }

    if (!primaryOk) {
        const fallback = await Promise.all(
            FALLBACK_SEARCH_ENGINES.map((engine) =>
                searchByEngine(engine, query, limit, offset),
            ),
        );
        for (const result of fallback) {
            if (!result.ok) {
                errors.push(`${result.engine}: ${result.message}`);
                continue;
            }
            total = Math.max(total, result.total || 0);
            collect(result.songs);
        }
    }

    return {
        songs: Array.from(merged.values()),
        total,
        errors,
        allFailed: !merged.size && errors.length > 0,
    };
}

// 批量取播放信息，一次请求多个 id
async function fetchPlaySources(ids) {
    const sources = new Map();
    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
        const data = await request('/api/song/enhance/player/url', {
            ids: JSON.stringify(chunk),
            br: CHECK_BR,
        });
        for (const item of data?.data || []) {
            sources.set(String(item.id), item);
        }
    }
    return sources;
}

// 整轨判定：播放地址接口的 time 字段是这段音源实际能播的时长，
// 拿它跟歌曲声明时长比最可靠；没有 time 时退回按字节数反推。
function isFullTrack(song, source) {
    if (!source?.url) {
        return false;
    }
    const duration = songDurationMs(song);
    const playable = Number(source.time || 0);
    if (duration > 0 && playable > 0) {
        return playable / duration >= FULL_TIME_RATIO;
    }
    if (duration <= 0 || !source.size || !source.br) {
        return false;
    }
    return source.size / (duration * (source.br / 8)) >= FULL_LENGTH_RATIO;
}

function scoreCandidate(song, origin) {
    // 歌名按归一化后比较：网易云上同一个歌名常有大小写差异
    // （「I Do It For You」vs「I Do It for You」），
    // 直接比原始字符串会把原唱版本判成「不同歌名」而被翻唱压下去。
    const name = normalizeTitle(song?.name);
    const originName = normalizeTitle(origin?.title);
    let score = 0;
    if (originName) {
        if (name === originName) {
            score += 100;
        } else if (name.includes(originName)) {
            score += 50;
        }
    }
    // 原唱歌手的版本最有用，翻唱往后排；
    // 合辑里挂了原唱名（The Romantic Orchestra / Bryan Adams）只算部分匹配。
    const artistLevel = artistMatchLevel(song, origin);
    if (artistLevel === 2) {
        score += 60;
    } else if (artistLevel === 1) {
        score += 25;
    }
    const originDuration = Number(origin?.duration || 0);
    if (originDuration > 0) {
        score -= Math.abs(songDurationMs(song) / 1000 - originDuration) / 60;
    }
    return score;
}

async function pickFullTrack(songs, origin) {
    const originId = String(origin?.id ?? '');
    const originDuration = Number(origin?.duration || 0);
    // 同一个版本常被不同用户重复上传，按「歌名+歌手+时长」去重
    const seen = new Set();
    const usable = (songs || []).filter((song) => {
        if (!song?.id || String(song.id) === originId || isNoiseVersion(song)) {
            return false;
        }
        // 明显短于原曲的片段不算这首歌的完整版
        if (originDuration > 0) {
            const duration = songDurationMs(song) / 1000;
            if (duration > 0 && duration < originDuration * MIN_DURATION_RATIO) {
                return false;
            }
        }
        const key = [
            String(song.name || ''),
            pickArtistName(song),
            Math.round(songDurationMs(song) / 1000),
        ].join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    if (!usable.length) {
        return [];
    }
    const sources = await fetchPlaySources(usable.map((song) => song.id));
    const full = usable.filter((song) =>
        isFullTrack(song, sources.get(String(song.id))),
    );
    full.sort((a, b) => scoreCandidate(b, origin) - scoreCandidate(a, origin));
    return full
        .map((song) => {
            const item = toMusicItem(song);
            if (!item) {
                return null;
            }
            item.isOriginArtist = isSameArtist(song, origin);
            item.durationDelta = originDuration
                ? Math.round(Math.abs(songDurationMs(song) / 1000 - originDuration))
                : null;
            return item;
        })
        .filter(Boolean);
}

// 只按歌名搜会大量漏掉原唱（翻唱挤在前面），
// 因此组合「干净歌名 / 原歌名 / 歌名+歌手 / 歌手名」多种查询。
function buildQueries(title, artist) {
    const queries = [];
    const clean = stripDecoration(title);
    if (clean && clean !== title) {
        queries.push(clean);
    }
    queries.push(title);
    // 检索词里已经带了歌手名就不用再拼一次，白白多打一次接口
    if (artist && !normalizeTitle(title).includes(normalizeTitle(artist))) {
        queries.push(`${title} ${artist}`);
    }
    return queries.filter(
        (query, index) => query && queries.indexOf(query) === index,
    );
}

module.exports = {
    platform: PLATFORM,
    version: '1.4.0',
    author: 'MusicFree',
    description:
        '网易云音乐完整版搜索：多引擎互备检索，只返回能整轨播放的歌曲，并可按歌名找出同一首歌的其他完整版本',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    // 关联歌词时一并存下歌名与歌手，网易云没有歌词时能据此去别的平台找
    primaryKey: ['title', 'artist'],
    userVariables: [
        {
            key: 'cookie',
            name: 'Cookie',
            hint: '可选，网易云音乐 Cookie。登录后 VIP 歌曲也能整轨播放',
        },
        {
            key: 'maxQuality',
            name: '最高音质',
            hint: 'low / standard / high / super，默认为 super',
        },
    ],

    async search(query, page, type) {
        if (type !== 'music') {
            return { isEnd: true, data: [] };
        }
        const current = Math.max(1, Number(page) || 1);
        const offset = (current - 1) * SEARCH_PAGE_SIZE;
        const { songs, total, errors, allFailed } = await searchMulti(
            String(query ?? ''),
            SEARCH_PAGE_SIZE,
            offset,
        );
        if (allFailed) {
            throw new Error(`搜索接口暂时不可用：${errors.join('; ')}`);
        }
        const data = await pickFullTrack(songs, null);
        return {
            data,
            isEnd: songs.length === 0 || (total > 0 ? offset + songs.length >= total : false),
        };
    },

    async getMusicAlternatives(musicItem, page, keyword) {
        // 用户可以自定义检索词，替换掉默认的歌名；歌手与时长基准仍取原曲
        const title = String(keyword ?? '').trim() || String(musicItem?.title || '').trim();
        const artist = String(musicItem?.artist || '').trim();
        if (!title) {
            throw new Error('缺少歌曲名');
        }

        const collected = new Map();
        const errors = [];
        let enginesAlive = false;

        for (const query of buildQueries(title, artist)) {
            const result = await searchMulti(query, CANDIDATE_LIMIT);
            errors.push(...result.errors);
            if (result.songs.length) {
                enginesAlive = true;
            }
            for (const song of result.songs) {
                const id = String(song.id);
                const previous = collected.get(id);
                collected.set(id, previous ? mergeSong(previous, song) : song);
            }
        }

        // 上面几轮仍没出现「同名且同歌手」时，再单独搜一次歌手名。
        // 歌手名检索会带进大量无关歌曲，靠歌名过滤兜住。
        const hasOrigin = Array.from(collected.values()).some(
            (song) => titleMatches(title, song.name) && isSameArtist(song, musicItem),
        );
        if (!hasOrigin && artist) {
            const result = await searchMulti(artist, CANDIDATE_LIMIT);
            errors.push(...result.errors);
            if (result.songs.length) {
                enginesAlive = true;
            }
            for (const song of result.songs) {
                const id = String(song.id);
                const previous = collected.get(id);
                collected.set(id, previous ? mergeSong(previous, song) : song);
            }
        }

        if (!enginesAlive && errors.length) {
            throw new Error(`搜索接口暂时不可用：${errors.join('; ')}`);
        }

        // 先按歌名相关性过滤，避免把上百条无关歌曲送去查播放地址
        let candidates = Array.from(collected.values()).filter(
            (song) => titleMatches(title, song.name),
        );
        if (!candidates.length) {
            candidates = Array.from(collected.values());
        }

        // 检索词换过了，比对时也按新歌名来，原曲的 id/歌手/时长不变
        const data = await pickFullTrack(candidates, { ...musicItem, title });
        return {
            isEnd: true,
            data: data.slice(0, ALTERNATIVE_LIMIT),
        };
    },

    async getMediaSource(musicItem, quality) {
        const id = musicItem?.id;
        if (!id) {
            throw new Error('缺少歌曲 ID');
        }
        const maxQuality = String(getUserVariables().maxQuality || '').trim();
        let target = QUALITY_BITRATE[quality] ? quality : 'standard';
        if (maxQuality && QUALITY_BITRATE[maxQuality]) {
            const order = ['low', 'standard', 'high', 'super'];
            if (order.indexOf(target) > order.indexOf(maxQuality)) {
                target = maxQuality;
            }
        }
        const data = await request('/api/song/enhance/player/url', {
            ids: '[' + id + ']',
            br: QUALITY_BITRATE[target],
        });
        const source = (data?.data || [])[0];
        if (!source?.url) {
            throw new Error('该歌曲暂无音源，可能需要登录或该歌曲为 VIP');
        }
        // time 是这段音源实际能播的时长。VIP 歌曲未登录时只有试听片段，
        // 登录后拿到的是整轨（fee 仍为 1），所以不能只看 fee。
        const declared = Number(musicItem?.duration || 0);
        const playable = Number(source.time || 0) / 1000;
        if (declared > 0 && playable > 0 && playable < declared * FULL_TIME_RATIO) {
            throw new Error(
                '该版本只能播放试听片段，可用「搜索完整播放版本」挑选整轨版本',
            );
        }
        return {
            url: toHttps(source.url),
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://music.163.com/',
            },
        };
    },

    async getLyric(musicItem) {
        const id = musicItem?.id;
        if (!id) {
            throw new Error('缺少歌曲 ID');
        }
        const data = await request('/api/song/lyric', {
            id: String(id),
            lv: 1,
            kv: 1,
            tv: -1,
        });
        const rawLrc = data?.lrc?.lyric || '';
        const translation = data?.tlyric?.lyric || '';
        if (isUsableLyric(rawLrc)) {
            return { rawLrc, translation };
        }
        // 网易云没有这首歌的歌词，改从 QQ 音乐与 LRCLIB 取
        const song = await resolveSongName(musicItem);
        const fallback = await fetchFallbackLyric(song.title, song.artist);
        if (fallback) {
            return fallback;
        }
        if (rawLrc.trim() || translation.trim()) {
            return { rawLrc, translation };
        }
        return { rawLrc: NO_LYRIC_LRC, translation: '' };
    },
};
