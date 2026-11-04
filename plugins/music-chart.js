/**
 * 音乐排行榜 —— 网易云音乐聚合插件
 *
 * 提供：排行榜 / 歌单详情 / 在线播放 / 搜索 / 歌词 / 歌单导入
 * 平台标识：音乐排行榜
 */

const axios = require('axios');

const PLATFORM = '音乐排行榜';
const API_HOST = 'https://music.163.com';

const SEARCH_PAGE_SIZE = 30;
const DETAIL_PAGE_SIZE = 50;

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const QUALITY_BITRATE = {
    low: 64000,
    standard: 128000,
    high: 320000,
    super: 999000,
};

const QUALITY_ORDER = ['low', 'standard', 'high', 'super'];

// 网易云 Web 接口在缺少客户端标识时只吐出 10 首歌，
// 带上 os / appver 才会返回完整歌单。
const CLIENT_COOKIE = { os: 'pc', appver: '2.9.7' };

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

const SEARCH_TYPE = {
    music: 1,
    album: 10,
    artist: 100,
    sheet: 1000,
    // 网易云没有开放歌词检索接口，退化为歌曲检索，
    // 选中后由 getLyric 按歌曲 id 取回歌词
    lyric: 1,
};

const OFFICIAL_CHART_IDS = ['19723756', '3779629', '2884035', '3778678'];

const GLOBAL_CHART_KEYWORDS = [
    'Billboard',
    'Oricon',
    'NRJ',
    'Beatport',
    'UK排行榜',
    '韩语榜',
    '日语榜',
    '俄语榜',
    '越南语榜',
    '泰语榜',
    '俄罗斯',
    '欧美',
    'R&B',
    '全球说唱',
];


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

// 多个搜索引擎互为备份：网易云对单个接口的风控是独立的，
// 一个被拦（405 操作频繁 / -462）时其余的仍然能返回结果。
// search/get 与 cloudsearch/pc 实测稳定，search/pc 与 search/get/web 波动大，只作兜底。
const SEARCH_ENGINES = [
    { name: 'search/get', path: '/api/search/get' },
    { name: 'cloudsearch/pc', path: '/api/cloudsearch/pc' },
];

const FALLBACK_SEARCH_ENGINES = [
    { name: 'search/pc', path: '/api/search/pc' },
    { name: 'search/get/web', path: '/api/search/get/web' },
];

async function searchByEngine(engine, query, type, limit, offset) {
    try {
        const params = { s: query, type, offset, limit };
        if (engine.path === '/api/search/get/web') {
            params.csrf_token = '';
            params.total = true;
        }
        const data = await request(engine.path, params);
        const result = data?.result;
        if (!result) {
            return {
                ok: false,
                engine: engine.name,
                message: data?.msg || `code=${data?.code}`,
            };
        }
        return { ok: true, engine: engine.name, result };
    } catch (e) {
        return { ok: false, engine: engine.name, message: e?.message || String(e) };
    }
}

// 合并多引擎结果：同 id 只留一条，计数取最大值
function mergeSearchResult(target, source) {
    Object.keys(source || {}).forEach((key) => {
        const value = source[key];
        if (Array.isArray(value)) {
            const seen = new Set((target[key] || []).map((item) => String(item?.id)));
            const merged = (target[key] || []).slice();
            value.forEach((item) => {
                const id = String(item?.id);
                if (!seen.has(id)) {
                    seen.add(id);
                    merged.push(item);
                }
            });
            target[key] = merged;
        } else if (typeof value === 'number') {
            target[key] = Math.max(target[key] || 0, value);
        } else if (target[key] === undefined) {
            target[key] = value;
        }
    });
    return target;
}

async function searchMulti(query, type, limit, offset) {
    const merged = {};
    const errors = [];
    let primaryOk = 0;

    const primary = await Promise.all(
        SEARCH_ENGINES.map((engine) =>
            searchByEngine(engine, query, type, limit, offset),
        ),
    );
    for (const item of primary) {
        if (!item.ok) {
            errors.push(`${item.engine}: ${item.message}`);
            continue;
        }
        primaryOk += 1;
        mergeSearchResult(merged, item.result);
    }

    if (!primaryOk) {
        const fallback = await Promise.all(
            FALLBACK_SEARCH_ENGINES.map((engine) =>
                searchByEngine(engine, query, type, limit, offset),
            ),
        );
        for (const item of fallback) {
            if (!item.ok) {
                errors.push(`${item.engine}: ${item.message}`);
                continue;
            }
            mergeSearchResult(merged, item.result);
        }
    }

    return {
        result: merged,
        errors,
        allFailed: !primaryOk && errors.length > 0,
    };
}

function pickArtistName(song) {
    const artists = song.ar || song.artists || [];
    if (Array.isArray(artists)) {
        return artists
            .map((item) => (typeof item === 'string' ? item : item?.name))
            .filter(Boolean)
            .join(' / ');
    }
    return artists?.name || '';
}

function toMusicItem(song) {
    if (!song || !song.id) {
        return null;
    }
    const album = song.al || song.album || {};
    const duration = song.duration ?? song.dt ?? song.dur ?? 0;
    return {
        id: String(song.id),
        platform: PLATFORM,
        title: song.name || '未知歌曲',
        artist: pickArtistName(song) || '未知歌手',
        album: album.name || '',
        artwork: toHttps(album.picUrl || album.blurPicUrl || ''),
        duration: Math.round(Number(duration) / 1000),
    };
}

function toSheetItem(playlist) {
    if (!playlist || !playlist.id) {
        return null;
    }
    return {
        id: String(playlist.id),
        platform: PLATFORM,
        title: playlist.name || '',
        artist: playlist.creator?.nickname || '',
        description: playlist.description || '',
        artwork: toHttps(playlist.coverImgUrl || playlist.picUrl || ''),
        playCount: playlist.playCount ?? playlist.subscribedCount ?? 0,
        trackCount: playlist.trackCount ?? 0,
        createAt: playlist.createTime ?? playlist.updateTime ?? 0,
    };
}

function toAlbumItem(album) {
    if (!album || !album.id) {
        return null;
    }
    return {
        id: String(album.id),
        platform: PLATFORM,
        title: album.name || '',
        artist: album.artist?.name || album.alias?.[0] || '',
        album: album.name || '',
        artwork: toHttps(album.picUrl || album.blurPicUrl || ''),
        description: album.description || album.briefDesc || '',
        createAt: album.publishTime ?? 0,
    };
}

function toArtistItem(artist) {
    if (!artist || !artist.id) {
        return null;
    }
    return {
        id: String(artist.id),
        platform: PLATFORM,
        title: artist.name || '',
        artist: (artist.alias || []).join(' / ') || artist.name || '',
        artwork: toHttps(artist.picUrl || artist.img1v1Url || ''),
        worksNum: artist.musicSize ?? 0,
    };
}

function toMusicList(tracks) {
    return (tracks || []).map(toMusicItem).filter(Boolean);
}

function pickPlaylist(detail) {
    return detail?.result || detail?.playlist || {};
}

async function fetchPlaylistDetail(id) {
    const detail = await request('/api/playlist/detail', { id: String(id) });
    return pickPlaylist(detail);
}

function paginate(list, page, pageSize) {
    const current = Math.max(1, Number(page) || 1);
    const start = (current - 1) * pageSize;
    return {
        musicList: list.slice(start, start + pageSize),
        isEnd: start + pageSize >= list.length,
    };
}

function extractSongId(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    if (/^\d+$/.test(text)) {
        return text;
    }
    const queryMatch = text.match(/[?&]id=(\d+)/);
    if (queryMatch) {
        return queryMatch[1];
    }
    const pathMatch = text.match(/music\.163\.com\/(?:m\/)?song\/(\d+)/);
    return pathMatch ? pathMatch[1] : null;
}

function extractResourceId(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    if (/^\d+$/.test(text)) {
        return { type: 'playlist', id: text };
    }
    const idMatch = text.match(/[?&]id=(\d+)/);
    if (!idMatch) {
        const pathMatch = text.match(/music\.163\.com\/(?:m\/)?(\w+)\/?(\d+)/);
        if (pathMatch) {
            return { type: pathMatch[1], id: pathMatch[2] };
        }
        return null;
    }
    if (/\/song\/?$/.test(text.split('?')[0]) || /\/song\/\d+/.test(text)) {
        return { type: 'song', id: idMatch[1] };
    }
    return { type: 'playlist', id: idMatch[1] };
}

module.exports = {
    platform: PLATFORM,
    version: '1.2.0',
    author: 'MusicFree',
    module: '榜单',
    defaultSearchType: 'music',
    // lyric 走歌曲检索（SEARCH_TYPE.lyric = 1），选中后由 getLyric 取回歌词
    supportedSearchType: ['music', 'album', 'artist', 'sheet', 'lyric'],
    // 关联歌词时一并存下歌名与歌手，网易云没有歌词时能据此去别的平台找
    primaryKey: ['title', 'artist'],
    hints: {
        importMusicSheet: [
            '支持网易云歌单链接、歌曲链接或纯 ID',
            '例如 https://music.163.com/playlist?id=3778678',
        ],
        importMusicItem: [
            '支持网易云歌曲链接或纯 ID',
            '例如 https://music.163.com/song?id=1962062993',
        ],
    },
    userVariables: [
        {
            key: 'cookie',
            name: 'Cookie',
            hint: '可选，网易云音乐 Cookie，登录后部分受限资源才可播放',
        },
        {
            key: 'maxQuality',
            name: '最高音质',
            hint: 'low / standard / high / super，默认为 super',
        },
    ],

    async getTopLists() {
        const data = await request('/api/toplist');
        const list = data?.list || [];

        const official = [];
        const globalCharts = [];
        const featured = [];

        list.forEach((item) => {
            const sheetItem = toSheetItem(item);
            if (!sheetItem) {
                return;
            }
            if (OFFICIAL_CHART_IDS.includes(sheetItem.id)) {
                official.push(sheetItem);
                return;
            }
            const isGlobal = GLOBAL_CHART_KEYWORDS.some((keyword) =>
                sheetItem.title.includes(keyword),
            );
            if (isGlobal) {
                globalCharts.push(sheetItem);
            } else {
                featured.push(sheetItem);
            }
        });

        return [
            { title: '官方榜单', data: official },
            { title: '全球榜单', data: globalCharts },
            { title: '特色榜单', data: featured },
        ];
    },

    async getTopListDetail(topListItem, page) {
        const id = topListItem?.id;
        if (!id) {
            return { topListItem: topListItem || {}, musicList: [], isEnd: true };
        }
        const playlist = await fetchPlaylistDetail(id);
        const musicList = toMusicList(playlist.tracks);
        const { musicList: currentList, isEnd } = paginate(
            musicList,
            page,
            DETAIL_PAGE_SIZE,
        );
        return {
            topListItem: {
                ...topListItem,
                ...(toSheetItem(playlist) || {}),
                trackCount: musicList.length,
            },
            musicList: currentList,
            isEnd,
        };
    },

    async getMusicSheetInfo(sheetItem, page) {
        const id = sheetItem?.id;
        if (!id) {
            return { sheetItem: sheetItem || {}, musicList: [], isEnd: true };
        }
        const playlist = await fetchPlaylistDetail(id);
        const musicList = toMusicList(playlist.tracks);
        const { musicList: currentList, isEnd } = paginate(
            musicList,
            page,
            DETAIL_PAGE_SIZE,
        );
        return {
            sheetItem: {
                ...sheetItem,
                ...(toSheetItem(playlist) || {}),
                trackCount: musicList.length,
            },
            musicList: currentList,
            isEnd,
        };
    },

    async getAlbumInfo(albumItem, page) {
        const id = albumItem?.id;
        if (!id) {
            return { albumItem: albumItem || {}, musicList: [], isEnd: true };
        }
        const data = await request('/api/album/' + encodeURIComponent(String(id)));
        const album = data?.album || {};
        const musicList = toMusicList(album.songs);
        const { musicList: currentList, isEnd } = paginate(
            musicList,
            page,
            DETAIL_PAGE_SIZE,
        );
        return {
            albumItem: { ...albumItem, ...(toAlbumItem(album) || {}) },
            musicList: currentList,
            isEnd,
        };
    },

    async importMusicItem(urlLike) {
        const id = extractSongId(urlLike);
        if (!id) {
            throw new Error('无法识别的歌曲链接或 ID');
        }
        const data = await request('/api/song/detail', { ids: '[' + id + ']' });
        const musicItem = toMusicItem((data?.songs || [])[0]);
        if (!musicItem) {
            throw new Error('未找到该歌曲');
        }
        return musicItem;
    },

    async importMusicSheet(input) {
        const resource = extractResourceId(input);
        if (!resource) {
            throw new Error('无法识别的歌单链接或 ID');
        }
        if (resource.type === 'song') {
            const data = await request('/api/song/detail', {
                ids: '[' + resource.id + ']',
            });
            const musicList = toMusicList(data?.songs);
            if (!musicList.length) {
                throw new Error('未找到该歌曲');
            }
            return musicList;
        }
        const playlist = await fetchPlaylistDetail(resource.id);
        const musicList = toMusicList(playlist.tracks);
        if (!musicList.length) {
            throw new Error('歌单为空，或需要登录后才能访问');
        }
        return musicList;
    },

    async getMediaSource(musicItem, quality) {
        const id = musicItem?.id;
        if (!id) {
            throw new Error('缺少歌曲 ID');
        }
        const maxQuality = String(getUserVariables().maxQuality || '').trim();
        let target = QUALITY_BITRATE[quality] ? quality : 'standard';
        if (maxQuality && QUALITY_BITRATE[maxQuality]) {
            const limit = QUALITY_ORDER.indexOf(maxQuality);
            const current = QUALITY_ORDER.indexOf(target);
            if (current > limit) {
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

    async search(query, page, type) {
        const searchType = SEARCH_TYPE[type] ?? SEARCH_TYPE.music;
        const current = Math.max(1, Number(page) || 1);
        const offset = (current - 1) * SEARCH_PAGE_SIZE;

        const { result, errors, allFailed } = await searchMulti(
            String(query ?? ''),
            searchType,
            SEARCH_PAGE_SIZE,
            offset,
        );
        if (allFailed) {
            throw new Error(`搜索接口暂时不可用：${errors.join('; ')}`);
        }

        let raw = [];
        let total = 0;

        if (searchType === 1) {
            raw = result.songs || [];
            total = result.songCount || 0;
        } else if (searchType === 10) {
            raw = result.albums || [];
            total = result.albumCount || 0;
        } else if (searchType === 100) {
            raw = result.artists || [];
            total = result.artistCount || 0;
        } else {
            raw = result.playlists || [];
            total = result.playlistCount || 0;
        }

        let data2 = [];
        if (type === 'album') {
            data2 = raw.map(toAlbumItem).filter(Boolean);
        } else if (type === 'artist') {
            data2 = raw.map(toArtistItem).filter(Boolean);
        } else if (type === 'sheet') {
            data2 = raw.map(toSheetItem).filter(Boolean);
        } else {
            data2 = raw.map(toMusicItem).filter(Boolean);
        }

        return {
            data: data2,
            isEnd: data2.length === 0 || offset + data2.length >= total,
        };
    },
};
