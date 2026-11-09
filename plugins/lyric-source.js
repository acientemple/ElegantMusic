/**
 * 歌词聚合 —— 多来源歌词检索插件
 *
 * 检索时同时问多个歌词平台，把同一首歌的结果合并成一条；
 * 取词时逐个来源尝试，挑与目标歌名歌手最贴合、时间轴完整的那一份。
 * 平台标识：歌词聚合
 */

const axios = require('axios');

const PLATFORM = '歌词聚合';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 网易云 Web 接口缺少客户端标识时只吐 10 条，带上才有完整结果
const NETEASE_COOKIE = 'os=pc; appver=2.9.7';

const PAGE_SIZE = 20;
const REQUEST_TIMEOUT = 8000;
// 单次取词的总预算，避免几个来源依次等待把调用拖到超时
const CALL_BUDGET = 8500;
// 同一首歌在每个平台最多保留几条来源，避免为重复结果反复发请求
const MAX_REFS_PER_SOURCE = 3;

const KUGOU_SONG_SEARCH_API = 'https://songsearch.kugou.com/song_search_v2';
const KUGOU_LYRIC_SEARCH_API = 'https://krcs.kugou.com/search';
const KUGOU_LYRIC_DOWNLOAD_API = 'https://lyrics.kugou.com/download';

const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

// 检索顺序即优先级：合并结果按它排序，挑歌词时也按它破平局
const SOURCE_ORDER = ['netease', 'qq', 'kugou', 'lrclib'];

function getUserVariables() {
    try {
        return env.getUserVariables() || {};
    } catch (e) {
        return {};
    }
}

function buildNeteaseCookie() {
    const raw = String(getUserVariables().cookie || '').trim();
    const map = new Map();
    raw.split(';').forEach((part) => {
        const text = part.trim();
        const index = text.indexOf('=');
        if (index > 0) {
            map.set(text.slice(0, index).trim(), text.slice(index + 1).trim());
        }
    });
    ['os', 'appver'].forEach((key) => {
        if (!map.has(key)) {
            const value = key === 'os' ? 'pc' : '2.9.7';
            map.set(key, value);
        }
    });
    return Array.from(map.entries())
        .map((entry) => `${entry[0]}=${entry[1]}`)
        .join('; ');
}

/** 有些接口把 JSON 当字符串返回，先试着解析一次 */
function parseMaybeJson(data) {
    if (typeof data !== 'string') {
        return data;
    }
    try {
        return JSON.parse(data);
    } catch (e) {
        return data;
    }
}

async function httpGet(url, params, headers, deadline) {
    const left = deadline ? deadline - Date.now() : REQUEST_TIMEOUT;
    const timeout = Math.max(500, Math.min(REQUEST_TIMEOUT, left));
    const response = await axios.get(url, {
        params: params || {},
        headers: {
            'user-agent': USER_AGENT,
            ...(headers || {}),
        },
        timeout,
    });
    return parseMaybeJson(response.data);
}

async function httpPost(url, body, headers, deadline) {
    const left = deadline ? deadline - Date.now() : REQUEST_TIMEOUT;
    const timeout = Math.max(500, Math.min(REQUEST_TIMEOUT, left));
    const response = await axios.post(url, body, {
        headers: {
            'user-agent': USER_AGENT,
            'content-type': 'application/json',
            ...(headers || {}),
        },
        timeout,
    });
    return parseMaybeJson(response.data);
}

/** 这段歌词里有没有词级时间戳（增强型 LRC 的 <mm:ss.xxx>） */
function hasWordTimestamp(lrc) {
    return /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(String(lrc || ''));
}

/* ------------------------------ 基础工具 ------------------------------ */

/** 酷狗的歌词内容是 base64 的 */
function decodeBase64(text) {
    const raw = String(text || '');
    if (!raw) {
        return '';
    }
    try {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(raw, 'base64').toString('utf8');
        }
    } catch (e) {
        // 落到下面的 atob 分支
    }
    try {
        const binary = atob(raw);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return '';
    }
}

/** 去掉 [ti:] [ar:] 这类头部信息 */
function cleanLyricHeader(lrc) {
    return String(lrc || '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*\[(ti|ar|al|by|id)\s*:/i.test(line))
        .join('\n');
}

/** 归一化歌名 / 歌手：去掉大小写、空白与标点 */
function lyricKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s·・\-_~,，。!！?？'"“”]/g, '');
}

/** 去掉括号里的修饰（Live / DJ版 / 官方版…） */
function lyricLooseKey(text) {
    return lyricKey(text).replace(/[（(\[【《][^）)\]】》]*[）)\]】》]/g, '');
}

/** 歌名与歌手都对得上才算命中 */
function matchScore(candidateTitle, candidateArtist, title, artist) {
    const ct = lyricKey(candidateTitle);
    const nt = lyricKey(title);
    if (!ct || !nt) {
        return 0;
    }
    let score = 0;
    if (ct === nt) {
        score += 4;
    } else if (lyricLooseKey(candidateTitle) === lyricLooseKey(title)) {
        score += 3;
    } else if (lyricLooseKey(candidateTitle).includes(lyricLooseKey(title))) {
        score += 1;
    }
    const ca = lyricKey(candidateArtist);
    const na = lyricKey(artist);
    if (na && ca) {
        if (ca === na) {
            score += 3;
        } else if (ca.includes(na) || na.includes(ca)) {
            score += 2;
        }
    }
    return score;
}

/** 版本类标记。画质类的修饰（无损 / 320K / FLAC）不算版本差异 */
const VERSION_PATTERNS = [
    /\blive\b|现场|演唱会|实况/i,
    /\bdj\b/i,
    /remix|混音/i,
    /翻唱|\bcover\b/i,
    /instrumental|伴奏|纯音乐|纯歌/i,
    /\bdemo\b|小样/i,
    /\bacoustic\b/i,
    /\bver\.?\b|\bversion\b|版本/i,
    /原版|官方版|正版|完整版/i,
    /remaster|重制/i,
];

function versionKinds(text) {
    const source = String(text || '');
    if (!source.trim()) {
        return [];
    }
    return VERSION_PATTERNS.filter((pattern) => pattern.test(source));
}

/**
 * 版本不一致要扣分。
 * 候选比目标多出版本标记（原版 vs Live / DJ / 翻唱）扣得最重，
 * 因为这类版本行数往往更多，只看行数会被它们顶掉
 */
function versionPenalty(candidateTitle, targetTitle) {
    if (!String(targetTitle || '').trim()) {
        return 0;
    }
    const candidate = versionKinds(candidateTitle);
    const target = versionKinds(targetTitle);
    if (!candidate.length && !target.length) {
        return 0;
    }
    if (!candidate.length) {
        return 60;
    }
    if (!target.length) {
        return 120;
    }
    const same =
        candidate.length === target.length &&
        candidate.every((pattern, index) => pattern === target[index]);
    if (same) {
        return 0;
    }
    const candidateExtra = candidate.filter((item) => !target.includes(item));
    const targetExtra = target.filter((item) => !candidate.includes(item));
    if (candidateExtra.length && !targetExtra.length) {
        return 120;
    }
    if (!candidateExtra.length && targetExtra.length) {
        return 60;
    }
    return 150;
}

/* ------------------------------ 检索 ------------------------------ */

function pickNeteaseArtists(song) {
    const artists = song.ar || song.artists || [];
    if (Array.isArray(artists)) {
        return artists
            .map((item) => (typeof item === 'string' ? item : item?.name))
            .filter(Boolean)
            .join(' / ');
    }
    return artists?.name || '';
}

async function searchNetease(query, page, deadline) {
    const data = await httpGet(
        'https://music.163.com/api/search/get',
        {
            s: query,
            type: 1,
            limit: PAGE_SIZE,
            offset: (Math.max(1, page) - 1) * PAGE_SIZE,
        },
        {
            referer: 'https://music.163.com/',
            origin: 'https://music.163.com',
            cookie: buildNeteaseCookie(),
        },
        deadline,
    );
    const songs = data?.result?.songs || [];
    return songs
        .filter((song) => song?.id)
        .map((song) => ({
            source: 'netease',
            sourceId: String(song.id),
            title: song.name || '',
            artist: pickNeteaseArtists(song),
            album: song.al?.name || song.album?.name || '',
            artwork: song.al?.picUrl || song.album?.picUrl || '',
            duration: Math.round(Number(song.duration ?? song.dt ?? 0) / 1000),
        }));
}

async function searchQQ(query, page, deadline) {
    const data = await httpGet(
        'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
        {
            p: Math.max(1, page),
            n: PAGE_SIZE,
            w: query,
            format: 'json',
        },
        { referer: 'https://y.qq.com/' },
        deadline,
    );
    const list = data?.data?.song?.list || [];
    return list
        .filter((song) => song?.songmid)
        .map((song) => ({
            source: 'qq',
            sourceId: String(song.songmid),
            title: song.songname || '',
            artist: (song.singer || [])
                .map((item) => item?.name)
                .filter(Boolean)
                .join(' / '),
            album: song.albumname || '',
            artwork: song.albummid
                ? `https://y.qq.com/music/photo_new/T002R300x300M000${song.albummid}.jpg`
                : '',
            duration: Number(song.interval) || 0,
        }));
}

/**
 * 酷狗的歌词检索接口只认歌曲的 hash，光给歌名搜不到候选，
 * 所以先用歌曲检索拿到 hash 与专辑，再据此查歌词
 */
async function searchKugou(query, page, deadline) {
    const data = await httpGet(
        KUGOU_SONG_SEARCH_API,
        {
            keyword: query,
            page: Math.max(1, page),
            pagesize: PAGE_SIZE,
            platform: 'WebFilter',
            userid: 0,
            clientver: 2000,
            iscorrection: 1,
            privilege_filter: 0,
            area_code: 1,
            filter: 10,
        },
        { referer: 'https://www.kugou.com/' },
        deadline,
    );
    const list = data?.data?.lists || [];
    return list
        .filter((item) => item?.FileHash)
        .map((item) => ({
            source: 'kugou',
            sourceId: String(item.FileHash),
            title: item.SongName || '',
            artist: item.SingerName || '',
            album: item.AlbumName || '',
            artwork: String(item.Image || '')
                .replace(/\{size\}/g, '400')
                .replace(/^http:\/\//, 'https://'),
            duration: Number(item.Duration) || 0,
            // 取歌词时要用到专辑 id 与时长
            albumId: String(item.AlbumID || ''),
        }));
}

async function searchLrclib(query, page, deadline) {
    const data = await httpGet(
        'https://lrclib.net/api/search',
        { q: query },
        { referer: 'https://lrclib.net/' },
        deadline,
    );
    const list = Array.isArray(data) ? data : [];
    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    return list
        .slice(start, start + PAGE_SIZE)
        .filter((item) => item?.id)
        .map((item) => ({
            source: 'lrclib',
            sourceId: String(item.id),
            title: item.trackName || '',
            artist: item.artistName || '',
            album: item.albumName || '',
            artwork: '',
            duration: Number(item.duration) || 0,
        }));
}

/* ------------------------------ 取词 ------------------------------ */

async function fetchNeteaseLyric(sourceId, deadline) {
    const data = await httpGet(
        'https://music.163.com/api/song/lyric',
        { id: sourceId, lv: 1, kv: 1, tv: -1 },
        {
            referer: 'https://music.163.com/',
            origin: 'https://music.163.com',
            cookie: buildNeteaseCookie(),
        },
        deadline,
    );
    return {
        rawLrc: data?.lrc?.lyric || '',
        translation: data?.tlyric?.lyric || '',
        // 逐字歌词（yrc 格式）。网易云只在登录后才给，这里取到就用
        wordLyric: data?.klyric?.lyric || '',
    };
}

async function fetchQQLyric(sourceId, deadline) {
    const data = await httpGet(
        'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
        {
            songmid: sourceId,
            format: 'json',
            nobase64: 1,
            g_tk: 5381,
        },
        { referer: 'https://y.qq.com/' },
        deadline,
    );
    if (Number(data?.code) !== 0) {
        return { rawLrc: '', translation: '' };
    }
    return {
        rawLrc: data?.lyric || '',
        translation: data?.trans || '',
    };
}

/**
 * QQ 的逐字歌词（qrc）。
 * 这个接口必须带登录 cookie 才会给词级时间戳，
 * cookie 由用户在插件的「用户变量」里配，取不到就当没有
 */
async function fetchQQWordLyric(sourceId, deadline) {
    const cookie = String(getUserVariables().cookie || '').trim();
    if (!cookie) {
        return '';
    }
    const data = await httpPost(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        {
            comm: { ct: 11, cv: '20170008', uin: '0' },
            req: {
                method: 'get_qrc_lyric',
                module: 'music.musichallSong.QrcSrv',
                param: { songmid: sourceId },
            },
        },
        { referer: 'https://y.qq.com/', cookie },
        deadline,
    );
    const qrc = String(data?.req?.data?.qrc || '');
    // qrc 的词级时间戳是 (start,duration,0)，跟行级歌词不是一回事，要单独判断
    return /\(\d+,\d+(,\d+)?\)/.test(qrc) ? qrc : '';
}

/**
 * 酷狗的歌词候选：一个歌名下常挂着氛围版、伴奏版、现场版，
 * 按歌名与时长挑出与这首歌对得上的那一条
 */
function pickKugouCandidate(candidates, ref) {
    const targetTitle = ref?.t || '';
    const targetDuration = Number(ref?.d || 0);
    return candidates
        .map((item) => {
            let score = 0;
            const ct = lyricKey(item.song || '');
            const nt = lyricKey(targetTitle);
            if (ct && nt) {
                if (ct === nt) {
                    score += 100;
                } else if (
                    lyricLooseKey(item.song) === lyricLooseKey(targetTitle)
                ) {
                    score += 80;
                } else if (
                    lyricLooseKey(item.song).includes(lyricLooseKey(targetTitle))
                ) {
                    score += 40;
                }
            }
            const duration = Math.round(Number(item.duration || 0) / 1000);
            if (targetDuration && duration) {
                const diff = Math.abs(duration - targetDuration);
                if (diff <= 3) {
                    score += 20;
                } else if (diff <= 10) {
                    score += 10;
                } else if (diff <= 30) {
                    score -= 10;
                } else {
                    score -= 30;
                }
            }
            if (/官方推荐歌词/.test(String(item.product_from || ''))) {
                score += 15;
            }
            score += Number(item.score) || 0;
            return { item, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.item || null;
}

async function fetchKugouLyric(ref, deadline) {
    const durationMs = Math.round(Number(ref?.d || 0)) * 1000;
    const data = await httpGet(
        KUGOU_LYRIC_SEARCH_API,
        {
            ver: 1,
            man: 'yes',
            client: 'pc',
            hash: ref.i,
            album_id: ref.al || undefined,
            duration: durationMs || undefined,
        },
        { referer: 'https://www.kugou.com/' },
        deadline,
    );
    const candidates = data?.candidates || [];
    if (!candidates.length) {
        return null;
    }
    const best = pickKugouCandidate(candidates, ref);
    if (!best?.accesskey) {
        return null;
    }
    const payload = await httpGet(
        KUGOU_LYRIC_DOWNLOAD_API,
        {
            ver: 1,
            client: 'pc',
            id: best.id,
            accesskey: best.accesskey,
            fmt: 'lrc',
            charset: 'utf8',
        },
        { referer: 'https://www.kugou.com/' },
        deadline,
    );
    const rawLrc = decodeBase64(payload?.content);
    if (!rawLrc) {
        return null;
    }
    const cleaned = cleanLyricHeader(rawLrc);
    return {
        rawLrc: cleaned,
        translation: '',
        // 酷狗有些歌词本身就是带词级时间戳的增强格式
        wordLyric: hasWordTimestamp(cleaned) ? cleaned : '',
    };
}

async function fetchLrclibLyric(ref, deadline) {
    const data = await httpGet(
        'https://lrclib.net/api/get',
        { track_name: ref.t || '', artist_name: ref.a || '' },
        { referer: 'https://lrclib.net/' },
        deadline,
    );
    return {
        rawLrc: data?.syncedLyrics || data?.plainLyrics || '',
        translation: '',
    };
}

async function fetchRefLyric(ref, deadline, target) {
    try {
        let lyric = null;
        if (ref.s === 'netease') {
            lyric = await fetchNeteaseLyric(ref.i, deadline);
        } else if (ref.s === 'qq') {
            lyric = await fetchQQLyric(ref.i, deadline);
            // QQ 的逐字歌词单独取，行级接口不给
            lyric.wordLyric = await fetchQQWordLyric(ref.i, deadline);
        } else if (ref.s === 'kugou') {
            lyric = await fetchKugouLyric(ref, deadline);
        } else if (ref.s === 'lrclib') {
            lyric = await fetchLrclibLyric(ref, deadline);
        }
        if (!lyric) {
            return null;
        }
        return {
            ...lyric,
            score: scoreLyric(lyric, ref, target),
        };
    } catch (e) {
        return null;
    }
}

/* ------------------------------ 歌词质量 ------------------------------ */

const TIMED_LINE = /\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/;
const PLACEHOLDER =
    /暂无(歌词|字幕|文本)|无(歌词|字幕)|歌词不存在|未找到歌词|no\s*lyrics?|lyrics?\s*not\s+found/i;

function countTimedLines(lrc) {
    if (!lrc) {
        return 0;
    }
    return lrc.split(/\r?\n/).filter((line) => TIMED_LINE.test(line)).length;
}

/** 是不是一份能用的歌词：至少两行带时间轴，且不是「暂无歌词」这类占位 */
function isUsableLyric(lrc) {
    if (!lrc || !lrc.trim()) {
        return false;
    }
    if (countTimedLines(lrc) < 2) {
        return false;
    }
    const plain = lrc
        .replace(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g, '')
        .replace(/^\[[a-z]+:.*\]$/gm, '')
        .trim();
    if (!plain) {
        return false;
    }
    const lines = plain.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length <= 1 && PLACEHOLDER.test(lines[0] || '')) {
        return false;
    }
    return true;
}

/** 正文中出现正常文字之外的字符，多半是编码错乱 */
const GOOD_CHAR =
    /[一-鿿㐀-䶿぀-ヿ가-힯　-〿＀-￯A-Za-z0-9\s.,!?;:'"()[\]_~|-]/;

function countGarbageLines(lrc) {
    if (!lrc) {
        return 0;
    }
    const lines = lrc.split(/\r?\n/).filter((line) => TIMED_LINE.test(line));
    let count = 0;
    lines.forEach((line) => {
        const text = line
            .replace(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g, '')
            .trim();
        if (!text) {
            return;
        }
        for (let index = 0; index < text.length; index++) {
            if (!GOOD_CHAR.test(text[index])) {
                count++;
                return;
            }
        }
    });
    return count;
}

/**
 * 打分以「与目标歌名歌手的匹配度」为主。
 * 早先只看时间轴行数，DJ 版、Live 版这类行数更多的版本总是胜出，
 * 现在匹配度占主导，行数与翻译只用来在同样贴合的候选之间破平局
 */
function scoreLyric(lyric, ref, target) {
    if (!isUsableLyric(lyric?.rawLrc)) {
        return -1;
    }
    let score = matchScore(ref?.t, ref?.a, target?.title, target?.artist) * 100;
    score += Math.min(countTimedLines(lyric.rawLrc), 60);
    if (lyric?.translation?.trim()) {
        score += 25;
    }
    score -= countGarbageLines(lyric.rawLrc) * 100;
    score -= versionPenalty(ref?.t, target?.title);
    return score;
}

/**
 * 从多份歌词里挑最好的：
 * 主体取分数最高的那份，翻译可以来自另一份（有的平台只给原文）
 */
function pickBestLyric(lyrics) {
    const usable = (lyrics || []).filter(
        (item) => item && item.score >= 0,
    );
    if (!usable.length) {
        return null;
    }
    usable.sort((a, b) => b.score - a.score);
    const main = usable[0];
    let translation = main.translation || '';
    if (!translation.trim()) {
        const timed = countTimedLines(main.rawLrc);
        const alternate = usable.find(
            (item) =>
                item.translation?.trim() &&
                countTimedLines(item.translation) >= Math.max(3, timed * 0.5),
        );
        translation = alternate?.translation || '';
    }
    return { rawLrc: main.rawLrc, translation };
}

/* ------------------------------ 合并结果 ------------------------------ */

function normalizeKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿぀-ヿ가-힯]/g, '');
}

function groupKeyOf(entry) {
    return `${normalizeKey(entry.title)}|${normalizeKey(entry.artist)}`;
}

/**
 * 一个来源实际对应哪一次取词请求。
 * LRCLIB 只能按「歌名 + 歌手」取词，同一个组合就是同一份歌词
 */
function fetchKeyOf(item) {
    const source = item.source || item.s;
    const id = item.sourceId || item.i;
    const title = item.title || item.t;
    const artist = item.artist || item.a;
    if (source === 'lrclib') {
        return `lrclib|${normalizeKey(title)}|${normalizeKey(artist)}`;
    }
    return `${source}|${id}`;
}

/** 去重并限制每个平台的来源数量 */
function dedupeRefs(refs) {
    const seen = new Set();
    const perSource = new Map();
    const result = [];
    (refs || []).forEach((ref) => {
        if (!ref?.s || !ref?.i) {
            return;
        }
        const key = fetchKeyOf(ref);
        if (seen.has(key)) {
            return;
        }
        const count = perSource.get(ref.s) || 0;
        if (count >= MAX_REFS_PER_SOURCE) {
            return;
        }
        seen.add(key);
        perSource.set(ref.s, count + 1);
        result.push(ref);
    });
    return result;
}

/** 同一首歌在多个平台各有一条，留下来源清单 */
function buildRefs(entries) {
    return dedupeRefs(
        entries.map((entry) => {
            const ref = {
                s: entry.source,
                i: entry.sourceId,
                t: entry.title,
                a: entry.artist,
            };
            // 酷狗取歌词时要用到专辑 id 与时长
            if (entry.albumId) {
                ref.al = entry.albumId;
            }
            if (entry.duration) {
                ref.d = entry.duration;
            }
            return ref;
        }),
    );
}

function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 同一首歌在多个平台各有一条，合并成一条并记下所有来源。
 * 合并按「标题 + 歌手」归一化后完全一致来判断，
 * 翻唱、Live 版等标题不同的版本仍然分开列出
 */
function mergeEntries(lists) {
    const groups = new Map();
    lists.forEach((list) => {
        (list || []).forEach((entry, index) => {
            const key = groupKeyOf(entry);
            let group = groups.get(key);
            if (!group) {
                group = { key, entries: [], sourceCount: 0, bestRank: index };
                groups.set(key, group);
            }
            group.entries.push(entry);
            group.bestRank = Math.min(group.bestRank, index);
        });
    });

    const ordered = Array.from(groups.values());
    ordered.forEach((group) => {
        group.entries.sort(
            (a, b) =>
                SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
        );
        group.sourceCount = new Set(
            group.entries.map((entry) => entry.source),
        ).size;
    });

    /**
     * 多个平台都收录的才是大家公认的那一版。
     * 网易云的检索常常把翻唱排在原唱前面，
     * 靠「命中平台数」把原唱顶到前面去
     */
    ordered.sort(
        (a, b) => b.sourceCount - a.sourceCount || a.bestRank - b.bestRank,
    );
    return ordered;
}

/** 标题带括号后缀、歌手名一长串的，多半是改编版，显示时挑干净的那条 */
function displayScore(entry) {
    let score = 0;
    if (!/[（(\[【《]/.test(entry.title || '')) {
        score += 4;
    }
    if ((entry.artist || '').length && entry.artist.length <= 24) {
        score += 2;
    }
    if (entry.artwork) {
        score += 1;
    }
    return score;
}

function toLyricItem(group) {
    const entries = group.entries;
    const refs = buildRefs(entries);
    const lyricKeyText = JSON.stringify(refs);
    const display = entries
        .slice()
        .sort(
            (a, b) =>
                displayScore(b) - displayScore(a) ||
                SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
        )[0];
    const withArtwork = entries.find((entry) => entry.artwork);
    return {
        id: hashText(lyricKeyText),
        platform: PLATFORM,
        title: display.title || '未知歌曲',
        artist: display.artist || '未知歌手',
        album: display.album || '',
        artwork: withArtwork?.artwork || '',
        duration: display.duration || 0,
        // 这两个字段会随关联一起存下来，取词失败时还能按歌名重新找
        lyricKey: lyricKeyText,
        lyricTitle: display.title || '',
        lyricArtist: display.artist || '',
    };
}

function decodeRefs(text) {
    try {
        const parsed = JSON.parse(String(text || ''));
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => item?.s && item?.i);
        }
    } catch (e) {
        // 关联数据损坏时按没有来源处理
    }
    return [];
}

async function searchAllSources(query, page, deadline) {
    const results = await Promise.all(
        [
            searchNetease(query, page, deadline).catch(() => []),
            searchQQ(query, page, deadline).catch(() => []),
            searchKugou(query, page, deadline).catch(() => []),
            searchLrclib(query, page, deadline).catch(() => []),
        ],
    );
    return results;
}

module.exports = {
    platform: PLATFORM,
    version: '1.3.0',
    author: 'MusicFree',
    module: '歌词',
    defaultSearchType: 'lyric',
    supportedSearchType: ['lyric'],
    // 关联歌词时把来源信息一起存下来，取词时才知道该问哪些平台
    primaryKey: ['lyricKey', 'lyricTitle', 'lyricArtist'],
    hints: {
        lyric: [
            '同时检索网易云音乐、QQ音乐、酷狗音乐与 LRCLIB，自动合并同一首歌',
        ],
    },
    userVariables: [
        {
            key: 'cookie',
            name: 'Cookie',
            hint: '可选，网易云音乐 Cookie，登录后检索结果更完整',
        },
    ],

    async search(query, page, type) {
        const keyword = String(query ?? '').trim();
        if (!keyword) {
            return { data: [], isEnd: true };
        }
        const current = Math.max(1, Number(page) || 1);
        const deadline = Date.now() + CALL_BUDGET;
        const lists = await searchAllSources(keyword, current, deadline);
        const groups = mergeEntries(lists);
        const data = groups.map(toLyricItem);
        const total = lists.reduce((sum, list) => sum + (list?.length || 0), 0);
        return {
            data,
            isEnd: data.length === 0 || total < PAGE_SIZE * 0.5,
        };
    },

    async getLyric(musicItem) {
        const deadline = Date.now() + CALL_BUDGET;
        // 目标就是这首歌本身，用来判断哪一份歌词才是对的
        const target = {
            title: musicItem?.title || musicItem?.lyricTitle || '',
            artist: musicItem?.artist || musicItem?.lyricArtist || '',
        };
        const refs = dedupeRefs(decodeRefs(musicItem?.lyricKey));
        const lyrics = await Promise.all(
            refs.map((ref) => fetchRefLyric(ref, deadline, target)),
        );
        let best = pickBestLyric(lyrics);

        if (!best) {
            // 记录下来的来源都没取到，按歌名重新找一遍
            const title = musicItem?.lyricTitle || musicItem?.title || '';
            const artist = musicItem?.lyricArtist || musicItem?.artist || '';
            if (title) {
                const keyword = [title, artist].filter(Boolean).join(' ').trim();
                const lists = await searchAllSources(keyword, 1, deadline);
                const groups = mergeEntries(lists).slice(0, 3);
                const retryRefs = [];
                groups.forEach((group) => {
                    group.entries.forEach((entry) => {
                        const ref = {
                            s: entry.source,
                            i: entry.sourceId,
                            t: entry.title,
                            a: entry.artist,
                        };
                        if (entry.albumId) {
                            ref.al = entry.albumId;
                        }
                        if (entry.duration) {
                            ref.d = entry.duration;
                        }
                        retryRefs.push(ref);
                    });
                });
                const retryLyrics = await Promise.all(
                    dedupeRefs(retryRefs)
                        .slice(0, 6)
                        .map((ref) => fetchRefLyric(ref, deadline, target)),
                );
                best = pickBestLyric(retryLyrics);
            }
        }

        if (!best) {
            return { rawLrc: NO_LYRIC_LRC, translation: '', wordLyric: '' };
        }
        return {
            rawLrc: best.rawLrc,
            translation: best.translation || '',
            // 逐字歌词：取到就用，取不到应用侧会按行均分生成
            wordLyric: best.wordLyric || '',
        };
    },
};
