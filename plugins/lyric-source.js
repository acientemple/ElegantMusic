/**
 * 歌词聚合 —— 多来源歌词检索插件
 *
 * 检索时同时问多个歌词平台，把同一首歌的结果合并成一条；
 * 取词时逐个来源尝试，挑带时间轴、行数多、有翻译的那一份。
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

const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

// 检索顺序即优先级：合并结果按它排序，挑歌词时也按它破平局
const SOURCE_ORDER = ['netease', 'qq', 'lrclib'];

const SOURCE_NAME = {
    netease: '网易云音乐',
    qq: 'QQ音乐',
    lrclib: 'LRCLIB',
};

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
    return response.data;
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

async function fetchRefLyric(ref, deadline) {
    try {
        let lyric = null;
        if (ref.s === 'netease') {
            lyric = await fetchNeteaseLyric(ref.i, deadline);
        } else if (ref.s === 'qq') {
            lyric = await fetchQQLyric(ref.i, deadline);
        } else if (ref.s === 'lrclib') {
            lyric = await fetchLrclibLyric(ref, deadline);
        }
        if (!lyric) {
            return null;
        }
        return { ...lyric, score: scoreLyric(lyric) };
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

/** 时间轴行数越多越好，有翻译再加一笔 */
function scoreLyric(lyric) {
    if (!isUsableLyric(lyric?.rawLrc)) {
        return -1;
    }
    let score = Math.min(countTimedLines(lyric.rawLrc), 60);
    if (lyric?.translation?.trim()) {
        score += 25;
    }
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
        entries.map((entry) => ({
            s: entry.source,
            i: entry.sourceId,
            t: entry.title,
            a: entry.artist,
        })),
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
    lists.forEach((list, sourceIndex) => {
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
    const lyricKey = JSON.stringify(refs);
    const display = entries
        .slice()
        .sort(
            (a, b) =>
                displayScore(b) - displayScore(a) ||
                SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
        )[0];
    const withArtwork = entries.find((entry) => entry.artwork);
    return {
        id: hashText(lyricKey),
        platform: PLATFORM,
        title: display.title || '未知歌曲',
        artist: display.artist || '未知歌手',
        album: display.album || '',
        artwork: withArtwork?.artwork || '',
        duration: display.duration || 0,
        // 这两个字段会随关联一起存下来，取词失败时还能按歌名重新找
        lyricKey,
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
            searchLrclib(query, page, deadline).catch(() => []),
        ],
    );
    return results;
}

module.exports = {
    platform: PLATFORM,
    version: '1.1.0',
    author: 'MusicFree',
    module: '歌词',
    defaultSearchType: 'lyric',
    supportedSearchType: ['lyric'],
    // 关联歌词时把来源信息一起存下来，取词时才知道该问哪些平台
    primaryKey: ['lyricKey', 'lyricTitle', 'lyricArtist'],
    hints: {
        lyric: ['同时检索网易云音乐、QQ音乐与 LRCLIB，自动合并同一首歌'],
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
        const refs = dedupeRefs(decodeRefs(musicItem?.lyricKey));
        const lyrics = await Promise.all(
            refs.map((ref) => fetchRefLyric(ref, deadline)),
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
                        retryRefs.push({
                            s: entry.source,
                            i: entry.sourceId,
                            t: entry.title,
                            a: entry.artist,
                        });
                    });
                });
                const retryLyrics = await Promise.all(
                    dedupeRefs(retryRefs)
                        .slice(0, 6)
                        .map((ref) => fetchRefLyric(ref, deadline)),
                );
                best = pickBestLyric(retryLyrics);
            }
        }

        if (!best) {
            return { rawLrc: NO_LYRIC_LRC, translation: '' };
        }
        return best;
    },
};
