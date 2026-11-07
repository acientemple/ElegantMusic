/**
 * 酷狗音乐 · 排行榜 / 搜索 / 取流 / 歌词
 *
 * 覆盖「音乐排行榜」页的酷狗 Tab，以及全局搜索、播放、歌词。
 * 酷狗的歌单（热门歌单）接口目前对未登录客户端一律返回 Access Deny / 404，
 * 因此本插件不实现 getRecommendSheetTags / getRecommendSheetsByTag / getMusicSheetInfo，
 * 「热门歌单」页不会出现酷狗 Tab —— 这是接口现状，不是遗漏。
 *
 * 音质说明：酷狗未登录的公开接口只发放 128k 直链。
 * playInfo 对 320hash / sqhash 一视同仁地降级到 128k，
 * mobileservice 的 api/v3/song/url 一律 Access Deny，
 * www.kugou.com/yy 的 play/getdata 需要登录态（err_code 30020）。
 * 所以本插件所有音质档位返回的都是 128k。
 *
 * 接口：
 * - 榜单列表  mobileservice.kugou.com/api/v5/rank/list?type=1
 * - 榜单详情  mobileservice.kugou.com/api/v5/rank/song?rankid=&page=&pagesize=
 * - 歌曲元信息 mobileservice.kugou.com/api/v3/song/info?hash=
 * - 取流      m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=
 * - 搜索      songsearch.kugou.com/song_search_v2?keyword=&page=&pagesize=
 * - 专辑搜索  mobileservice.kugou.com/api/v3/search/album?keyword=
 * - 歌手搜索  mobileservice.kugou.com/api/v3/search/singer?keyword=
 * - 歌词      krcs.kugou.com/search → lyrics.kugou.com/download
 */
const axios = require('axios');

const PLATFORM = '酷狗音乐';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const RANK_LIST_API = 'https://mobileservice.kugou.com/api/v5/rank/list';
const RANK_SONG_API = 'https://mobileservice.kugou.com/api/v5/rank/song';
const SONG_INFO_API = 'https://mobileservice.kugou.com/api/v3/song/info';
const PLAY_INFO_API = 'https://m.kugou.com/app/i/getSongInfo.php';
const SEARCH_API = 'https://songsearch.kugou.com/song_search_v2';
const ALBUM_SEARCH_API = 'https://mobileservice.kugou.com/api/v3/search/album';
const SINGER_SEARCH_API = 'https://mobileservice.kugou.com/api/v3/search/singer';
const SINGER_INFO_API = 'https://mobileservice.kugou.com/api/v3/singer/info';
const LYRIC_SEARCH_API = 'https://krcs.kugou.com/search';
const LYRIC_DOWNLOAD_API = 'https://lyrics.kugou.com/download';
const QQ_SEARCH_API = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_API = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_LINK_API = 'https://api.vkeys.cn/music/tencent/song/link';
const LRCLIB_API = 'https://lrclib.net/api/get';

const RANK_PAGE_SIZE = 50;
const SEARCH_PAGE_SIZE = 30;
const LYRIC_TIMEOUT = 6000;
const LRCLIB_TIMEOUT = 3000;
const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

/** 榜单分组名，对应官方接口的 classify 字段 */
const RANK_GROUP_TITLE = {
    1: '官方榜单',
    2: '地区榜单',
    3: '年代与经典',
    4: '国际榜单',
    5: '风格榜单',
};


/* ---------------------------- 基础工具 ---------------------------- */

function buildHeaders(extra) {
    return {
        'user-agent': USER_AGENT,
        referer: 'https://www.kugou.com/',
        ...(extra || {}),
    };
}

function getUserVariables() {
    try {
        return env.getUserVariables() || {};
    } catch (e) {
        return {};
    }
}

async function getJson(url, params, options) {
    const config = options || {};
    const response = await axios.get(url, {
        params: params || {},
        headers: buildHeaders(config.headers),
        timeout: config.timeout || 15000,
    });
    return response.data;
}

/** 酷狗的图片地址里带 {size} 占位 */
function toImage(url, size = 400) {
    if (!url) {
        return '';
    }
    return String(url).replace(/\{size\}/g, String(size)).replace(/^http:\/\//, 'https://');
}

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


/* ---------------------------- 数据转换 ---------------------------- */

/** 榜单条目 */
function toSheetItem(rank) {
    if (!rank || !rank.rank_cid) {
        return null;
    }
    return {
        id: String(rank.rank_cid),
        platform: PLATFORM,
        title: rank.rankname || '',
        artist: '',
        artwork: toImage(rank.img_9),
        description: String(rank.intro || '').replace(/\s+/g, ' ').trim(),
        playCount: Number(rank.play_times) || 0,
    };
}

/** 榜单 / 歌曲详情里的歌曲结构 */
function toMusicItem(song) {
    if (!song || !song.hash) {
        return null;
    }
    const artists = (song.authors || [])
        .map((item) => item && item.author_name)
        .filter(Boolean)
        .join(',');
    return {
        id: String(song.hash),
        platform: PLATFORM,
        title: song.songname || '未知歌曲',
        artist: artists || '未知歌手',
        album: song.albumname || song.album_name || '',
        artwork: toImage(song.album_sizable_cover || song.album_img || song.img_9),
        duration: Math.round(Number(song.duration) || 0),
    };
}

/** 搜索接口里的歌曲结构（字段名与榜单不同） */
function toMusicItemFromSearch(item) {
    if (!item || !item.FileHash) {
        return null;
    }
    return {
        id: String(item.FileHash),
        platform: PLATFORM,
        title: item.SongName || '未知歌曲',
        artist: item.SingerName || '未知歌手',
        album: item.AlbumName || '',
        artwork: toImage(item.Image),
        duration: Math.round(Number(item.Duration) || 0),
    };
}

function toAlbumItem(item) {
    if (!item || !item.albumid) {
        return null;
    }
    return {
        id: String(item.albumid),
        platform: PLATFORM,
        title: item.albumname || '',
        artist: item.singername || '',
        album: item.albumname || '',
        artwork: toImage(item.imgurl),
        worksNum: Number(item.songcount) || 0,
        description: String(item.intro || '').trim(),
        createAt: item.publishtime ? Date.parse(String(item.publishtime).replace(/-/g, '/')) : undefined,
    };
}

function toArtistItem(item, profile) {
    if (!item || !item.singerid) {
        return null;
    }
    return {
        id: String(item.singerid),
        platform: PLATFORM,
        title: item.singername || '',
        artist: item.singername || '',
        artwork: toImage(item.avatar || item.headurl) || (profile && profile.avatar) || '',
        description: profile && profile.description,
        worksNum: (profile && profile.worksNum) || 0,
    };
}

/**
 * 歌手搜索只给 id 与名字，头像要从详情接口单独取
 */
async function fetchSingerProfile(singerid) {
    const data = await getJson(
        SINGER_INFO_API,
        { singerid: String(singerid) },
        { timeout: 8000 },
    ).catch(() => null);
    const info = data?.data;
    if (!info) {
        return null;
    }
    return {
        avatar: toImage(info.imgurl),
        description: String(info.intro || info.profile || '').trim(),
        worksNum: Number(info.songcount) || 0,
    };
}


/* ---------------------------- 歌词 ---------------------------- */

/** 至少两行带时间轴、且不是「暂无歌词」才算有用的歌词 */
function isUsableLyric(lrc) {
    const text = String(lrc || '');
    const timed = text
        .split(/\r?\n/)
        .filter((line) => /\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/.test(line)).length;
    if (timed < 2) {
        return false;
    }
    return !/暂无(歌词|字幕)|歌词不存在|no\s*lyrics?/i.test(text);
}

/** 去掉 [ti:] [ar:] [id:] 这类头部信息 */
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

/**
 * 酷狗歌词：krcs.kugou.com 搜候选，再从 lyrics.kugou.com 下载
 * 关键词必须带歌手，只给歌名基本搜不到候选
 */
async function fetchKugouLyric(title, artist, durationSec) {
    const keyword = [title, artist].filter(Boolean).join(' ').trim();
    if (!keyword) {
        return null;
    }
    const duration = Math.round(Number(durationSec) || 0) * 1000;
    const data = await getJson(
        LYRIC_SEARCH_API,
        { ver: 1, man: 'yes', client: 'pc', keyword, duration: duration || undefined },
        { timeout: LYRIC_TIMEOUT },
    ).catch(() => null);
    const candidates = data?.candidates || [];
    if (!candidates.length) {
        return null;
    }
    // 同一个歌名下常挂着「氛围版 /  remix / 现场版」，时长对不上的先剔掉
    const tolerance = Math.max(10000, duration * 0.12);
    const filtered = duration
        ? candidates.filter(
              (item) =>
                  !item.duration || Math.abs(Number(item.duration) - duration) <= tolerance,
          )
        : candidates;
    const pool = filtered.length ? filtered : candidates;
    const ranked = pool
        .map((item) => ({
            item,
            score:
                matchScore(item.song || '', item.singer || '', title, artist) * 100 +
                // 酷狗自带的相关度（10~60）与来源标记，作为次要权重
                (Number(item.score) || 0) +
                (/官方推荐歌词/.test(String(item.product_from || '')) ? 30 : 0) +
                (duration && item.duration
                    ? Math.max(0, 10 - Math.abs(Number(item.duration) - duration) / 1000)
                    : 0),
        }))
        .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || !best.item.accesskey) {
        return null;
    }
    const payload = await getJson(
        LYRIC_DOWNLOAD_API,
        {
            ver: 1,
            client: 'pc',
            id: best.item.id,
            accesskey: best.item.accesskey,
            fmt: 'lrc',
            charset: 'utf8',
        },
        { timeout: LYRIC_TIMEOUT },
    ).catch(() => null);
    const rawLrc = decodeBase64(payload?.content);
    if (!rawLrc) {
        return null;
    }
    return { rawLrc: cleanLyricHeader(rawLrc), translation: '' };
}

/** 酷狗没有歌词时，从 QQ 音乐按歌名找原唱取词 */
async function fetchQQLyric(title, artist) {
    const query = [title, artist].filter(Boolean).join(' ').trim();
    if (!query) {
        return null;
    }
    const data = await getJson(
        QQ_SEARCH_API,
        { p: 1, n: 10, w: query, format: 'json' },
        { timeout: LYRIC_TIMEOUT, headers: { referer: 'https://y.qq.com/' } },
    ).catch(() => null);
    const list = (data && data.data && data.data.song && data.data.song.list) || [];
    const ranked = list
        .map((song) => {
            const singer = (song.singer || [])
                .map((item) => item && item.name)
                .filter(Boolean)
                .join(' / ');
            return {
                songmid: song.songmid,
                score: matchScore(song.songname || '', singer, title, artist),
            };
        })
        .filter((item) => item.songmid)
        .sort((a, b) => b.score - a.score);
    for (const item of ranked.slice(0, 2)) {
        if (item.score < 4) {
            break;
        }
        const lyric = await getJson(
            QQ_LYRIC_API,
            { songmid: item.songmid, format: 'json', nobase64: 1, g_tk: 5381 },
            { timeout: LYRIC_TIMEOUT, headers: { referer: 'https://y.qq.com/' } },
        ).catch(() => null);
        if (Number(lyric && lyric.code) === 0 && lyric && lyric.lyric) {
            return { rawLrc: cleanLyricHeader(lyric.lyric), translation: lyric.trans || '' };
        }
    }
    return null;
}

/** LRCLIB 只能按「歌名 + 歌手」取词 */
async function fetchLrclibLyric(title, artist) {
    if (!title) {
        return null;
    }
    try {
        const data = await getJson(
            LRCLIB_API,
            { track_name: title, artist_name: artist || '' },
            { timeout: LRCLIB_TIMEOUT, headers: { referer: 'https://lrclib.net/' } },
        );
        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        return rawLrc ? { rawLrc, translation: '' } : null;
    } catch (e) {
        return null;
    }
}


/* ---------------------------- 取流 ---------------------------- */

/**
 * 用 hash 换播放直链。
 * 主接口对高音质 hash 一律降级到 128k，这里保持同样的降级链：
 * 先试原始 hash，再试 320hash / sqhash（对 30 秒试听版或失效 hash 有意义）。
 */
async function fetchPlayUrl(hash) {
    if (!hash) {
        return null;
    }
    const data = await getJson(
        PLAY_INFO_API,
        { cmd: 'playInfo', hash: String(hash) },
        { timeout: 10000 },
    ).catch(() => null);
    if (!data || Number(data.status) !== 1) {
        return null;
    }
    const url = data.url || (Array.isArray(data.backup_url) ? data.backup_url[0] : '');
    if (!url) {
        return null;
    }
    return {
        url,
        bitRate: Number(data.bitRate) || 0,
        fileSize: Number(data.fileSize) || 0,
    };
}

/** 拿到歌曲各音质档位的 hash（320hash / sqhash） */
async function fetchQualityHashes(hash) {
    const data = await getJson(
        SONG_INFO_API,
        { hash: String(hash) },
        { timeout: 10000 },
    ).catch(() => null);
    const extra = data?.data?.extra || {};
    return {
        base: String(hash),
        high: extra['320hash'] || '',
        super: extra.sqhash || '',
    };
}

/**
 * 酷狗拿不到音源时（付费曲最常见），去 QQ 音乐找同名歌取流。
 * 只在歌名与歌手都对得上、时长也接近时才用，避免播成别的版本。
 */
async function fetchQQPlayUrl(title, artist, durationSec, quality) {
    const query = [title, artist].filter(Boolean).join(' ').trim();
    if (!query) {
        return null;
    }
    const data = await getJson(
        QQ_SEARCH_API,
        { p: 1, n: 10, w: query, format: 'json' },
        { timeout: 6000, headers: { referer: 'https://y.qq.com/' } },
    ).catch(() => null);
    const list = (data && data.data && data.data.song && data.data.song.list) || [];
    const duration = Math.round(Number(durationSec) || 0);
    const ranked = list
        .map((song) => {
            const singer = (song.singer || [])
                .map((item) => item && item.name)
                .filter(Boolean)
                .join(' / ');
            const interval = Math.round(Number(song.interval) || 0);
            let score = matchScore(song.songname || '', singer, title, artist);
            if (duration && interval && Math.abs(interval - duration) > 12) {
                score -= 4;
            }
            return { songmid: song.songmid, score };
        })
        .filter((item) => item.songmid)
        .sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 6) {
        return null;
    }
    const levels =
        quality === 'super' ? [10, 8, 6] : quality === 'high' ? [8, 6] : [6];
    for (const item of ranked.slice(0, 2)) {
        for (const level of levels) {
            const link = await getJson(
                QQ_LINK_API,
                { mid: item.songmid, quality: level },
                { timeout: 8000 },
            ).catch(() => null);
            const url = link && link.data && link.data.url;
            if (url) {
                return {
                    url,
                    kbps: (link.data && link.data.kbps) || '',
                    from: 'QQ音乐',
                };
            }
        }
    }
    return null;
}


/* ---------------------------- 完整版候选 ---------------------------- */

/** 每轮检索取多少条 */
const ALTERNATIVE_QUERY_LIMIT = 30;
/** 最终返回的候选上限 */
const ALTERNATIVE_LIMIT = 20;
/** 最多实测多少个候选的可播长度 */
const ALTERNATIVE_PROBE_LIMIT = 10;
/** 实测时的并发数 */
const ALTERNATIVE_PROBE_CONCURRENCY = 5;
/** 可播时长与歌曲时长之比达到这个值才算整轨 */
const FULL_TRACK_RATIO = 0.9;

/** 并发受限的 map，避免一次打出几十个请求 */
async function mapWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) {
        runners.push(
            (async () => {
                for (;;) {
                    const index = cursor++;
                    if (index >= items.length) {
                        return;
                    }
                    results[index] = await worker(items[index], index);
                }
            })(),
        );
    }
    await Promise.all(runners);
    return results;
}

/** 歌名匹配度：3=一致，1=候选以原歌名开头，0=无关 */
function titleMatchLevel(originTitle, candidateTitle) {
    const origin = lyricLooseKey(originTitle);
    const candidate = lyricLooseKey(candidateTitle);
    if (!origin || !candidate) {
        return 0;
    }
    if (origin === candidate) {
        return 3;
    }
    // 只认「候选以原歌名开头」这一种扩展，双向包含会把「十年」当成「时光倒流二十年」
    if (origin.length >= 2 && candidate.length >= 2 && candidate.startsWith(origin)) {
        return 1;
    }
    return 0;
}

/** 拆歌手名，酷狗的多歌手条目用逗号分隔 */
function splitArtistNames(text) {
    return String(text || '')
        .split(/[,，、\/&·;]/)
        .map((item) => lyricKey(item))
        .filter(Boolean);
}

/** 候选与原曲歌手的关系：2=完全同名，1=一方包含另一方，0=无关 */
function artistMatchLevel(song, origin) {
    const originArtists = splitArtistNames(origin?.artist);
    if (!originArtists.length) {
        return 0;
    }
    const candidates = (
        Array.isArray(song?.Singers) && song.Singers.length
            ? song.Singers.map((item) => lyricKey(item?.name))
            : splitArtistNames(song?.SingerName)
    ).filter(Boolean);
    if (!candidates.length) {
        return 0;
    }
    let best = 0;
    for (const candidate of candidates) {
        for (const originArtist of originArtists) {
            if (candidate === originArtist) {
                best = Math.max(best, 2);
            } else if (
                candidate.length >= 2 &&
                originArtist.length >= 2 &&
                (candidate.includes(originArtist) || originArtist.includes(candidate))
            ) {
                best = Math.max(best, 1);
            }
        }
    }
    return best;
}

/** 候选排序分：同名同唱优先，时长接近原曲的靠前 */
function scoreCandidate(song, origin) {
    let score = 0;
    const titleLevel = titleMatchLevel(origin?.title, song?.SongName);
    if (titleLevel === 3) {
        score += 100;
    } else if (titleLevel === 1) {
        score += 40;
    }
    const artistLevel = artistMatchLevel(song, origin);
    if (artistLevel === 2) {
        score += 60;
    } else if (artistLevel === 1) {
        score += 25;
    }
    const originDuration = Number(origin?.duration || 0);
    const duration = Number(song?.Duration || 0);
    if (originDuration > 0 && duration > 0) {
        score -= Math.abs(duration - originDuration) / 60;
    }
    return score;
}

/** 只按歌名搜会漏掉原唱，组合多种查询词 */
function buildAlternativeQueries(title, artist) {
    const queries = [];
    const clean = String(title || '')
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (clean && clean !== title) {
        queries.push(clean);
    }
    queries.push(title);
    if (artist) {
        queries.push(`${title} ${artist}`);
    }
    return queries.filter((query, index) => query && queries.indexOf(query) === index);
}

/** 检索歌曲，返回酷狗搜索接口的原始条目 */
async function searchSongs(keyword, limit) {
    const data = await getJson(SEARCH_API, {
        keyword,
        page: 1,
        pagesize: limit,
        platform: 'WebFilter',
        userid: 0,
        clientver: 2000,
        iscorrection: 1,
        privilege_filter: 0,
        area_code: 1,
        filter: 10,
    }).catch(() => null);
    const list = data?.data?.lists;
    return Array.isArray(list) ? list : [];
}

/**
 * 实测这首歌在酷狗上能播多长（秒）。
 * 付费曲的 playInfo 会返回 status=0，fileSize 取不到，这里直接判定为不可用。
 */
async function measurePlayableLength(song) {
    const hash = String(song?.FileHash || '');
    if (!hash) {
        return 0;
    }
    const info = await fetchPlayUrl(hash);
    if (!info || !info.fileSize || !info.bitRate) {
        return 0;
    }
    return (info.fileSize * 8) / (info.bitRate * 1000);
}

/** 挑出真正能整轨播放的候选 */
async function pickFullTracks(candidates, origin) {
    const originDuration = Number(origin?.duration || 0);
    const originId = origin?.platform === PLATFORM ? String(origin?.id || '') : '';
    const ranked = candidates
        .filter((song) => song?.FileHash && String(song.FileHash) !== originId)
        .map((song) => ({ song, score: scoreCandidate(song, origin) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, ALTERNATIVE_PROBE_LIMIT);
    if (!ranked.length) {
        return [];
    }
    const measured = await mapWithLimit(
        ranked,
        ALTERNATIVE_PROBE_CONCURRENCY,
        (entry) => measurePlayableLength(entry.song),
    );
    const full = [];
    ranked.forEach((entry, index) => {
        const song = entry.song;
        const playable = Number(measured[index]) || 0;
        // 测不出长度说明这首在酷狗拿不到音源（付费曲最常见），直接排除
        if (playable <= 0) {
            return;
        }
        const selfDuration = Number(song.Duration || 0);
        // 音源长度要能对上这首歌自己的元数据，否则只是同名片段
        if (selfDuration > 0 && playable / selfDuration < FULL_TRACK_RATIO) {
            return;
        }
        // 还要跟原曲差不多长，避免把别的版本塞给用户
        const reference = originDuration > 0 ? originDuration : selfDuration;
        if (reference > 0 && playable / reference < FULL_TRACK_RATIO) {
            return;
        }
        full.push(entry);
    });
    full.sort((a, b) => b.score - a.score);
    return full
        .map((entry) => {
            const item = toMusicItemFromSearch(entry.song);
            if (!item) {
                return null;
            }
            item.isOriginArtist = artistMatchLevel(entry.song, origin) === 2;
            item.durationDelta = originDuration
                ? Math.round(Math.abs(Number(entry.song.Duration || 0) - originDuration))
                : null;
            return item;
        })
        .filter(Boolean);
}


/* ---------------------------- 插件 ---------------------------- */

module.exports = {
    version: '1.1.0',
    module: '榜单',
    platform: PLATFORM,
    author: '',
    description: '酷狗音乐榜单、搜索与完整版搜索',
    website: 'https://www.kugou.com/',
    defaultSearchType: 'music',
    supportedSearchType: ['music', 'album', 'artist', 'lyric'],
    primaryKey: ['title', 'artist'],

    userVariables: [
        {
            key: 'preferHighQuality',
            name: '优先高音质',
            hint: 'true 时先试 320/无损的 hash。酷狗未登录接口对高音质 hash 也会降级到 128k',
        },
    ],

    /** 榜单列表 */
    async getTopLists() {
        const data = await getJson(RANK_LIST_API, { type: 1 }).catch(() => null);
        const list = data?.data?.info || [];
        const groups = new Map();
        for (const rank of list) {
            const item = toSheetItem(rank);
            if (!item) {
                continue;
            }
            const key = Number(rank.classify) || 1;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }
        return Array.from(groups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([key, data]) => ({
                title: RANK_GROUP_TITLE[key] || '其它榜单',
                data,
            }));
    },

    /** 榜单详情，服务端分页有效 */
    async getTopListDetail(topListItem, page) {
        const rankid = topListItem?.id;
        if (!rankid) {
            throw new Error('缺少榜单 ID');
        }
        const current = Math.max(1, Number(page) || 1);
        const data = await getJson(RANK_SONG_API, {
            rankid,
            page: current,
            pagesize: RANK_PAGE_SIZE,
        }).catch(() => null);
        const list = data?.data?.info || [];
        const total = Number(data?.data?.total) || list.length;
        const musicList = list.map(toMusicItem).filter(Boolean);
        return {
            topListItem,
            musicList,
            isEnd: current * RANK_PAGE_SIZE >= total || musicList.length === 0,
        };
    },

    /** 播放地址 */
    async getMediaSource(musicItem, quality) {
        const hash = musicItem?.id;
        if (!hash) {
            throw new Error('缺少歌曲 ID');
        }
        const preferHigh = String(getUserVariables().preferHighQuality || '').trim() === 'true';

        let source = await fetchPlayUrl(hash);
        if (!source && preferHigh) {
            const hashes = await fetchQualityHashes(hash);
            source =
                (await fetchPlayUrl(hashes.high)) || (await fetchPlayUrl(hashes.super));
        }
        if (source) {
            return {
                url: source.url,
                headers: {
                    'user-agent': USER_AGENT,
                    referer: 'https://www.kugou.com/',
                },
                quality: 'standard',
            };
        }
        // 酷狗没有音源（付费曲最常见），退回 QQ 音乐取同一首歌
        const fromQQ = await fetchQQPlayUrl(
            String(musicItem?.title || '').trim(),
            String(musicItem?.artist || '').trim(),
            Number(musicItem?.duration) || 0,
            quality,
        );
        if (!fromQQ) {
            throw new Error('该歌曲暂无音源');
        }
        return {
            url: fromQQ.url,
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://y.qq.com/',
            },
            quality: fromQQ.kbps || 'standard',
        };
    },

    /** 歌词：酷狗 → QQ → LRCLIB */
    async getLyric(musicItem) {
        const title = String(musicItem?.title || '').trim();
        const artist = String(musicItem?.artist || '').trim();
        const duration = Number(musicItem?.duration) || 0;

        const fromKugou = await fetchKugouLyric(title, artist, duration).catch(() => null);
        if (fromKugou && isUsableLyric(fromKugou.rawLrc)) {
            return fromKugou;
        }
        const fromQQ = await fetchQQLyric(title, artist).catch(() => null);
        if (fromQQ && isUsableLyric(fromQQ.rawLrc)) {
            return fromQQ;
        }
        const fromLrclib = await fetchLrclibLyric(title, artist).catch(() => null);
        if (fromLrclib && isUsableLyric(fromLrclib.rawLrc)) {
            return fromLrclib;
        }
        if (fromKugou) {
            return fromKugou;
        }
        if (fromQQ) {
            return fromQQ;
        }
        return { rawLrc: NO_LYRIC_LRC, translation: '' };
    },

    /** 查找同一首歌的其他可完整播放版本 */
    async getMusicAlternatives(musicItem) {
        const title = String(musicItem?.title || '').trim();
        const artist = String(musicItem?.artist || '').trim();
        if (!title) {
            throw new Error('缺少歌曲名');
        }

        const collected = new Map();
        let alive = false;
        const collect = (list) => {
            for (const song of list) {
                const hash = String(song?.FileHash || '');
                if (!hash) {
                    continue;
                }
                collected.set(hash, { ...(collected.get(hash) || {}), ...song });
            }
        };

        for (const query of buildAlternativeQueries(title, artist)) {
            const list = await searchSongs(query, ALTERNATIVE_QUERY_LIMIT);
            if (list.length) {
                alive = true;
            }
            collect(list);
        }

        // 前几轮没搜到同名同歌手时，再单独用歌手名搜一轮
        const hasOrigin = Array.from(collected.values()).some(
            (song) =>
                titleMatchLevel(title, song.SongName) === 3 &&
                artistMatchLevel(song, musicItem) === 2,
        );
        if (!hasOrigin && artist) {
            const list = await searchSongs(artist, ALTERNATIVE_QUERY_LIMIT);
            if (list.length) {
                alive = true;
            }
            collect(list);
        }

        if (!alive) {
            throw new Error('搜索接口暂时不可用');
        }

        const all = Array.from(collected.values());
        let candidates = all.filter(
            (song) => titleMatchLevel(title, song.SongName) > 0,
        );
        if (!candidates.length) {
            candidates = all;
        }

        const data = await pickFullTracks(candidates, musicItem);
        return {
            isEnd: true,
            data: data.slice(0, ALTERNATIVE_LIMIT),
        };
    },

    /** 搜索 */
    async search(query, page, type) {
        const keyword = String(query ?? '').trim();
        if (!keyword) {
            return { data: [], isEnd: true };
        }
        const current = Math.max(1, Number(page) || 1);

        if (type === 'album') {
            const data = await getJson(
                ALBUM_SEARCH_API,
                { keyword, pagesize: SEARCH_PAGE_SIZE, page: current },
            ).catch(() => null);
            const list = data?.data?.info || [];
            const total = Number(data?.data?.total) || 0;
            const items = list.map(toAlbumItem).filter(Boolean);
            return {
                data: items,
                isEnd: items.length === 0 || current * SEARCH_PAGE_SIZE >= total,
            };
        }

        if (type === 'artist') {
            const data = await getJson(
                SINGER_SEARCH_API,
                { keyword, pagesize: SEARCH_PAGE_SIZE, page: current },
            ).catch(() => null);
            const list = Array.isArray(data?.data) ? data.data : [];
            const items = list.map(toArtistItem).filter(Boolean);
            // 头像是详情接口才有的，只补前面一批，避免一页发几十个请求
            await Promise.all(
                items.slice(0, 12).map(async (item) => {
                    const profile = await fetchSingerProfile(item.id);
                    if (profile) {
                        item.artwork = item.artwork || profile.avatar;
                        item.description = item.description || profile.description;
                        item.worksNum = item.worksNum || profile.worksNum;
                    }
                }),
            );
            return { data: items, isEnd: items.length === 0 || items.length < SEARCH_PAGE_SIZE };
        }

        const data = await getJson(SEARCH_API, {
            keyword,
            page: current,
            pagesize: SEARCH_PAGE_SIZE,
            platform: 'WebFilter',
            userid: 0,
            clientver: 2000,
            iscorrection: 1,
            privilege_filter: 0,
            area_code: 1,
            filter: 10,
        }).catch(() => null);
        const list = data?.data?.lists || [];
        const total = Number(data?.data?.total) || 0;
        const items = list.map(toMusicItemFromSearch).filter(Boolean);
        return {
            data: items,
            isEnd: items.length === 0 || current * SEARCH_PAGE_SIZE >= total,
        };
    },

    /** 导入单曲：支持酷狗歌曲页链接与裸 hash */
    async importMusicItem(urlLike) {
        const raw = String(urlLike || '').trim();
        if (!raw) {
            throw new Error('无效的链接');
        }
        const matched = raw.match(/([0-9A-Fa-f]{32})/);
        const hash = matched ? matched[1] : '';
        if (!hash) {
            throw new Error('无法解析歌曲 ID');
        }
        const data = await getJson(SONG_INFO_API, { hash }).catch(() => null);
        const song = data?.data;
        if (!song) {
            throw new Error('未能获取歌曲信息');
        }
        const filename = String(song.filename || '');
        const singer = song.singername || '';
        const title = song.songname || filename.split(' - ').pop() || '';
        return {
            id: String(hash).toUpperCase(),
            platform: PLATFORM,
            title,
            artist: singer,
            album: '',
            artwork: toImage(song.imgurl),
            duration: Math.round(Number(song.duration) || 0),
        };
    },
};
