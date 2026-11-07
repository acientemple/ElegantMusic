/**
 * QQ音乐 —— 榜单 / 热门歌单 / 在线播放 / 歌词 / 搜索
 *
 * 平台标识：QQ音乐
 *
 * 接口说明（均为 2026-11 实测可用）：
 * - 榜单详情 c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg（服务端分页无效，插件内切片）
 * - 歌单列表 c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg（响应包在 MusicJsonCallback 壳里）
 * - 歌单详情 api.injahow.cn/meting（Meting 唯一可用路径；QQ 官方歌单接口全部要登录）
 * - 取流   api.vkeys.cn/music/tencent/song/link
 * - 歌词   c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg
 */

const axios = require('axios');

const PLATFORM = 'QQ音乐';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const TOP_LIST_API = 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg';
const DISS_BY_TAG_API = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg';
const SEARCH_API = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const SMARTBOX_API = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const LYRIC_API = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const VKEYS_LINK_API = 'https://api.vkeys.cn/music/tencent/song/link';
const VKEYS_INFO_API = 'https://api.vkeys.cn/music/tencent/song/info';
const METING_API = 'https://api.injahow.cn/meting/';
const LRCLIB_API = 'https://lrclib.net/api/get';

const DETAIL_PAGE_SIZE = 50;
const SHEET_PAGE_SIZE = 30;
const SEARCH_PAGE_SIZE = 30;
/** 补全歌曲元数据时的并发数 */
const ENRICH_CONCURRENCY = 8;
/** 歌曲元数据缓存上限，超出后按写入顺序淘汰 */
const META_CACHE_LIMIT = 800;

const NO_LYRIC_LRC = '[00:00.00]暂无歌词';
const LRCLIB_TIMEOUT = 3000;

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。

/** vkeys 的 quality 档位：2=48k 3=96k 4=191k 6=128k 7=189k(ogg) 8=320k 9=338k(ogg) 10=flac 11=hires */
// 有些歌只发了高音质、没有 128k 档，standard 里补上 8/7 兜住
const VKEYS_QUALITY_CHAIN = {
    low: [3, 2, 4],
    standard: [6, 3, 8, 7],
    high: [8, 7, 6],
    super: [10, 11, 9, 8],
};

const VKEYS_QUALITY_KEY = {
    2: 'low',
    3: 'low',
    4: 'standard',
    6: 'standard',
    7: 'standard',
    8: 'high',
    9: 'high',
    10: 'super',
    11: 'super',
};

const QUALITY_ORDER = ['low', 'standard', 'high', 'super'];

/** 歌单排序方式，id 即接口的 sortId */
const SHEET_SORT_TAGS = [
    { id: '5', title: '最热歌单' },
    { id: '2', title: '最新歌单' },
];

/**
 * 榜单清单没有接口（page=list 与 topid=0 都返回 code=-1），
 * 这里按 2026-11 实测扫描 topid 1..160 的结果写死，
 * 已剔除 8 个空榜与 2 个重名重复项。
 */
const TOP_LISTS = [
    {
        title: '官方榜单',
        data: [
            { id: '26', title: '巅峰榜·热歌', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150820174743.jpg' },
            { id: '27', title: '巅峰榜·新歌', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150820174831.jpg' },
            { id: '23', title: '巅峰榜·畅销', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150507125834.jpg' },
            { id: '34', title: '巅峰榜·人气', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/1463455060577089421.jpg' },
            { id: '62', title: '飙升榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/1743216.png' },
            { id: '76', title: '音乐巅峰榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/3968859.png' },
            { id: '35', title: 'QQ音乐巅峰分享榜', artwork: 'https://y.gtimg.cn/music/common//upload/iphone_order_channel/20151120174607.jpg' },
            { id: '77', title: '扑通指数榜', artwork: '' },
            { id: '67', title: '听歌识曲榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1843530.png' },
            { id: '4', title: '巅峰榜·流行指数', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1847681.png' },
            { id: '32', title: '巅峰榜·音乐人', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/52845.png' },
        ],
    },
    {
        title: '地区与语种',
        data: [
            { id: '5', title: '巅峰榜·内地', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150122151407.jpg' },
            { id: '6', title: '巅峰榜·港台', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20141110193534.jpg' },
            { id: '3', title: '巅峰榜·欧美', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150122151215.jpg' },
            { id: '16', title: '巅峰榜·韩国', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150122151656.jpg' },
            { id: '17', title: '巅峰榜·日本', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150122151730.jpg' },
            { id: '59', title: '香港地区榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1246132.png' },
            { id: '61', title: '台湾地区榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1246137.png' },
            { id: '74', title: 'Q音快手榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/2633655.png' },
            { id: '60', title: '抖音热歌榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/6775670.png' },
            { id: '28', title: '巅峰榜·网络歌曲', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1219597.png' },
        ],
    },
    {
        title: '风格与题材',
        data: [
            { id: '57', title: '电音榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/4620698.png' },
            { id: '58', title: '说唱榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/701149.png' },
            { id: '63', title: 'DJ舞曲榜', artwork: '' },
            { id: '65', title: '国风热歌榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1743517.png' },
            { id: '66', title: 'ACG新歌榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1743509.png' },
            { id: '70', title: '达人音乐榜', artwork: '' },
            { id: '72', title: '动漫音乐榜', artwork: '' },
            { id: '73', title: '游戏音乐榜', artwork: '' },
            { id: '78', title: '国乐榜', artwork: '' },
            { id: '29', title: '巅峰榜·影视金曲', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1219587.png' },
            { id: '36', title: '巅峰榜·K歌金曲', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/34147.png' },
            { id: '52', title: '巅峰榜·腾讯音乐人原创榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/141029.png' },
            { id: '131', title: '校园音乐人排行榜', artwork: '' },
            { id: '75', title: '有声榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/2952090.png' },
            { id: '53', title: '机车', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/239013.png' },
        ],
    },
    {
        title: '综艺与节目',
        data: [
            { id: '25', title: '巅峰榜·中国新歌声', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/126363.jpg' },
            { id: '30', title: '巅峰榜·梦想的声音', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/200132.jpg' },
            { id: '33', title: '全军出击·巅峰榜·歌手2018', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/234556.jpg' },
            { id: '50', title: '巅峰榜·中国有嘻哈', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/126373.jpg' },
            { id: '51', title: '巅峰榜·明日之子', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/128066.jpg' },
            { id: '54', title: '勇闯天涯·巅峰榜·明日之子', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/297764.png' },
            { id: '55', title: '江小白YOLO·巅峰榜·中国新说唱', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/309506.png' },
            { id: '56', title: '巅峰榜·2018中国好声音', artwork: 'https://y.gtimg.cn/music/common//upload/t_order_channel_hitlist_conf/313497.png' },
            { id: '64', title: '综艺新歌榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1743522.png' },
            { id: '159', title: '特色推荐·网络新声', artwork: 'https://y.gtimg.cn/music/common//upload/iphone_order_channel/20141126162013.jpg' },
            { id: '160', title: '特色推荐·独立原创', artwork: 'https://y.gtimg.cn/music/common//upload/iphone_order_channel/20141126162200.jpg' },
        ],
    },
    {
        title: '全球榜单',
        data: [
            { id: '103', title: '台湾Hito中文榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/332670.jpg' },
            { id: '105', title: '日本公信榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/7061447.png' },
            { id: '106', title: '韩国Mnet榜', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20141126200251.jpg' },
            { id: '107', title: '英国UK榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/7061461.png' },
            { id: '108', title: '美国公告牌榜', artwork: 'https://y.gtimg.cn/music/common/upload/t_order_channel_hitlist_conf/7074537.jpg' },
            { id: '113', title: '香港电台榜', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20141126200747.jpg' },
            { id: '114', title: '香港商台榜', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150126160044.jpg' },
            { id: '117', title: '台湾幽浮榜', artwork: 'https://y.gtimg.cn/music/common//upload/iphone_order_channel/20141126200528.jpg' },
            { id: '123', title: '美国热门音乐榜', artwork: 'https://y.gtimg.cn/music/common/upload/iphone_order_channel/20150126160335.jpg' },
            { id: '126', title: 'JOOX本地热播榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1248415.png' },
            { id: '127', title: '台湾KKBOX榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/7061467.png' },
            { id: '128', title: 'YouTube音乐排行榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/1248461.png' },
            { id: '129', title: '韩国Melon榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/7058335.png' },
            { id: '130', title: '香港TVB劲歌金榜', artwork: 'https://y.gtimg.cn/music/common/upload/test_order_channel_hitlist_con/3866670.png' },
        ],
    },
];

/** 歌曲元数据缓存：mid -> Promise<元数据|null> */
const songMetaCache = new Map();
/** 歌单曲目缓存：dissid -> Promise<曲目数组> */
const sheetTrackCache = new Map();


/* ---------------------------- 基础工具 ---------------------------- */

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

function buildHeaders(extra) {
    return {
        'user-agent': USER_AGENT,
        referer: 'https://y.qq.com/',
        ...(extra || {}),
    };
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

/** 取原始文本（用于 MusicJsonCallback 这类带壳的响应） */
async function getText(url, params, options) {
    const config = options || {};
    const response = await axios.get(url, {
        params: params || {},
        headers: buildHeaders(config.headers),
        timeout: config.timeout || 15000,
        transformResponse: [(data) => data],
    });
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
}

/** 剥掉 MusicJsonCallback(...) 的外壳 */
function unwrapJsonp(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
    return JSON.parse(match ? match[1] : raw);
}

function albumArt(albummid) {
    return albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albummid}_1.jpg`
        : '';
}

function pickSingerName(singers) {
    if (Array.isArray(singers)) {
        return singers
            .map((item) => (typeof item === 'string' ? item : item?.name))
            .filter(Boolean)
            .join(' / ');
    }
    return singers?.name || '';
}

/** QQ 的 createAt 是 "2020-09-06" 这样的日期串，要转成毫秒时间戳 */
function parseCreateAt(text) {
    if (!text) {
        return 0;
    }
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) {
        return value;
    }
    const time = new Date(String(text).replace(/-/g, '/')).getTime();
    return Number.isFinite(time) ? time : 0;
}

function paginate(list, page, pageSize) {
    const current = Math.max(1, Number(page) || 1);
    const start = (current - 1) * pageSize;
    return {
        musicList: list.slice(start, start + pageSize),
        isEnd: start + pageSize >= list.length,
    };
}

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

/** 去掉 [ti:] [ar:] 这类头部信息，用户上传版本的这一段常是混合编码乱码 */
function cleanLyricHeader(lrc) {
    return String(lrc || '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*\[(ti|ar|al|by)\s*:/i.test(line))
        .join('\n');
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
            { timeout: LRCLIB_TIMEOUT },
        );
        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        return rawLrc ? { rawLrc, translation: '' } : null;
    } catch (e) {
        return null;
    }
}


/* ---------------------------- 数据转换 ---------------------------- */

/** 榜单 / 搜索接口里的歌曲结构 */
function toMusicItem(song) {
    if (!song || !song.songmid) {
        return null;
    }
    const artist = pickSingerName(song.singer);
    return {
        id: String(song.songmid),
        platform: PLATFORM,
        title: song.songname || '未知歌曲',
        artist: artist || '未知歌手',
        album: song.albumname || '',
        artwork: albumArt(song.albummid),
        duration: Math.round(Number(song.interval) || 0),
    };
}

/** vkeys 的歌曲元数据结构 */
function toMusicItemFromMeta(meta, fallback) {
    const mid = meta?.songMID || fallback?.mid;
    if (!mid) {
        return null;
    }
    return {
        id: String(mid),
        platform: PLATFORM,
        title: meta?.title || fallback?.title || '未知歌曲',
        artist: meta?.singer || fallback?.artist || '未知歌手',
        album: meta?.album || '',
        artwork: toHttps(meta?.cover || '') || albumArt(fallback?.albummid),
        duration: Math.round(Number(meta?.interval) || 0),
    };
}

function toSheetItem(diss) {
    if (!diss || !diss.dissid) {
        return null;
    }
    return {
        id: String(diss.dissid),
        platform: PLATFORM,
        title: diss.dissname || '',
        artist: diss.creator?.name || '',
        description: diss.introduction || '',
        artwork: toHttps(diss.imgurl || ''),
        playCount: Number(diss.listennum) || 0,
        createAt: parseCreateAt(diss.createtime),
    };
}

function toAlbumItem(item) {
    if (!item || !item.mid) {
        return null;
    }
    return {
        id: String(item.mid),
        platform: PLATFORM,
        title: item.name || '',
        artist: item.singer || '',
        album: item.name || '',
        artwork: toHttps(item.pic || ''),
    };
}

function toArtistItem(item) {
    if (!item || !item.mid) {
        return null;
    }
    return {
        id: String(item.mid),
        platform: PLATFORM,
        title: item.name || '',
        artist: item.singer || item.name || '',
        artwork: toHttps(item.pic || ''),
    };
}


/* ---------------------------- 接口封装 ---------------------------- */

/** 按 songmid 取歌曲元数据（时长 / 专辑 / 封面），带缓存 */
function fetchSongMeta(mid) {
    if (!mid) {
        return Promise.resolve(null);
    }
    const cached = songMetaCache.get(mid);
    if (cached) {
        return cached;
    }
    if (songMetaCache.size >= META_CACHE_LIMIT) {
        const oldest = songMetaCache.keys().next().value;
        songMetaCache.delete(oldest);
    }
    const task = getJson(VKEYS_INFO_API, { mid })
        .then((res) => (res && res.code === 0 ? res.data : null))
        .catch(() => null);
    songMetaCache.set(mid, task);
    return task;
}

/** 榜单详情：接口不分页，整表返回，由插件自己切片 */
async function fetchTopListSongs(topid) {
    const data = await getJson(TOP_LIST_API, {
        topid: String(topid),
        format: 'json',
        page: 'detail',
        type: 'top',
    });
    if (!data || Number(data.code) !== 0) {
        return { info: {}, songs: [] };
    }
    const songs = (data.songlist || []).map((item) => item?.data).filter(Boolean);
    return { info: data.topinfo || {}, songs };
}

/** 歌单列表：sin / ein 是排序后列表的下标区间 */
async function fetchSheetList(sortId, page) {
    const current = Math.max(1, Number(page) || 1);
    const sin = (current - 1) * SHEET_PAGE_SIZE;
    const ein = current * SHEET_PAGE_SIZE - 1;
    const text = await getText(DISS_BY_TAG_API, {
        g_tk: 5381,
        login_type: 0,
        hostUin: 0,
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 0,
        categoryId: 10000000,
        sortId: String(sortId),
        sin,
        ein,
    });
    const json = unwrapJsonp(text);
    const list = json?.data?.list || [];
    const total = Number(json?.data?.sum) || 0;
    return { list, total, next: ein + 1 };
}

/** 从 Meting 的 url / pic 里取出 songmid 与 albummid */
function parseMetingId(url) {
    const match = String(url || '').match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

/** 歌单曲目：Meting 是唯一可用的 QQ 歌单路径 */
function fetchSheetTracks(dissid) {
    const key = String(dissid);
    const cached = sheetTrackCache.get(key);
    if (cached) {
        return cached;
    }
    const task = getJson(METING_API, {
        server: 'tencent',
        type: 'playlist',
        id: key,
    })
        .then((list) =>
            (Array.isArray(list) ? list : [])
                .map((track) => ({
                    mid: parseMetingId(track?.url),
                    albummid: parseMetingId(track?.pic),
                    title: track?.name || '',
                    artist: track?.artist || '',
                }))
                .filter((track) => track.mid),
        )
        .catch(() => []);
    sheetTrackCache.set(key, task);
    return task;
}

/** 给曲目补全时长 / 专辑 / 封面 */
async function enrichTracks(tracks) {
    const metas = await mapWithLimit(tracks, ENRICH_CONCURRENCY, (track) =>
        fetchSongMeta(track.mid),
    );
    return tracks
        .map((track, index) => toMusicItemFromMeta(metas[index], track))
        .filter(Boolean);
}

/** 按音质取直链，逐档降级 */
async function fetchMediaUrl(mid, quality) {
    const chain = VKEYS_QUALITY_CHAIN[quality] || VKEYS_QUALITY_CHAIN.standard;
    for (const level of chain) {
        const res = await getJson(VKEYS_LINK_API, { mid, quality: level }).catch(() => null);
        const url = res && res.code === 0 ? res.data?.url : null;
        if (url) {
            return { url: toHttps(url), level };
        }
    }
    return null;
}


/* ---------------------------- 完整版候选 ---------------------------- */

/** 每轮检索取多少条 */
const ALTERNATIVE_QUERY_LIMIT = 30;
/** 最终返回的候选上限 */
const ALTERNATIVE_LIMIT = 20;
/** 最多实测多少个候选的音频长度 */
const ALTERNATIVE_PROBE_LIMIT = 10;
/** 实测长度时的并发数 */
const ALTERNATIVE_PROBE_CONCURRENCY = 5;
/** 实测直链时依次尝试的音质档，与 standard 播放链保持一致 */
const ALTERNATIVE_PROBE_QUALITIES = [6, 3, 8, 7];
/** 可播时长与歌曲时长之比达到这个值才算整轨 */
const FULL_TRACK_RATIO = 0.9;

/** 归一化歌名：去括号内容、去标点、转小写 */
function normalizeTitle(text) {
    return String(text || '')
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
        .replace(/[\s\-–—_·、,，.。!！?？'"“”‘’]+/g, '')
        .toLowerCase()
        .trim();
}

/** 剥掉歌名里的修饰成分，如「光年之外（Live）」→「光年之外」 */
function stripDecoration(title) {
    const cleaned = String(title || '')
        .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || String(title || '').trim();
}

/**
 * 歌名匹配度：3=完全一致，2=去掉修饰后一致，1=候选以原歌名开头，0=无关
 */
function titleMatchLevel(originTitle, candidateTitle) {
    const origin = normalizeTitle(originTitle);
    const candidate = normalizeTitle(candidateTitle);
    if (!origin || !candidate) {
        return 0;
    }
    if (origin === candidate) {
        return 3;
    }
    const cleanOrigin = normalizeTitle(stripDecoration(originTitle));
    const cleanCandidate = normalizeTitle(stripDecoration(candidateTitle));
    if (cleanOrigin && cleanCandidate && cleanOrigin === cleanCandidate) {
        return 2;
    }
    // 只认「候选以原歌名开头」这一种扩展，双向包含会把「十年」当成「时光倒流二十年」
    if (origin.length >= 2 && candidate.length >= 2 && candidate.startsWith(origin)) {
        return 1;
    }
    return 0;
}

/** 拆歌手名，QQ 的多歌手条目用 / 分隔 */
function splitArtists(text) {
    return String(text || '')
        .split(/[\/、,&·;]/)
        .map((item) => normalizeTitle(item))
        .filter(Boolean);
}

/** 候选与原曲歌手的关系：2=完全同名，1=一方包含另一方，0=无关 */
function artistMatchLevel(song, origin) {
    const originArtists = splitArtists(origin?.artist);
    if (!originArtists.length) {
        return 0;
    }
    const candidates = (Array.isArray(song?.singer) ? song.singer : [])
        .map((item) => normalizeTitle(typeof item === 'string' ? item : item?.name))
        .filter(Boolean);
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
    const titleLevel = titleMatchLevel(origin?.title, song?.songname);
    if (titleLevel === 3) {
        score += 100;
    } else if (titleLevel === 2) {
        score += 70;
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
    const duration = Number(song?.interval || 0);
    if (originDuration > 0 && duration > 0) {
        score -= Math.abs(duration - originDuration) / 60;
    }
    return score;
}

/** 只按歌名搜会大量漏掉原唱（翻唱挤在前面），因此组合多种查询词 */
function buildAlternativeQueries(title, artist) {
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
    return queries.filter((query, index) => query && queries.indexOf(query) === index);
}

/** 检索歌曲，返回 QQ 搜索接口的原始条目 */
async function searchSongs(keyword, limit) {
    const data = await getJson(SEARCH_API, {
        p: 1,
        n: limit,
        w: keyword,
        t: 0,
        format: 'json',
    }).catch(() => null);
    const list = data?.data?.song?.list;
    return Array.isArray(list) ? list : [];
}

/** 解析 vkeys 的 kbps 字段，如 "320kbps" */
function parseKbps(text) {
    const value = Number(String(text || '').replace(/[^\d.]/g, ''));
    return value > 0 ? value : 0;
}

/** 用 Range 请求读回文件的总字节数 */
async function fetchContentTotal(url) {
    try {
        const response = await axios.get(toHttps(url), {
            headers: buildHeaders({ Range: 'bytes=0-1' }),
            timeout: 8000,
            responseType: 'arraybuffer',
            validateStatus: (status) => status >= 200 && status < 400,
        });
        const range = String(response.headers?.['content-range'] || '');
        const matched = range.match(/\/(\d+)\s*$/);
        if (matched) {
            return Number(matched[1]);
        }
        const length = Number(response.headers?.['content-length']);
        return length > 2 ? length : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 实测这首歌在 QQ 上能播多长（秒）。
 * 直链只给 30 秒试听时，读回的字节数换算出来会明显短于歌曲时长。
 * 返回 { playable, hasUrl }：hasUrl=false 表示这首歌根本拿不到音源。
 */
async function measurePlayableLength(mid) {
    for (const quality of ALTERNATIVE_PROBE_QUALITIES) {
        const link = await getJson(VKEYS_LINK_API, { mid, quality }).catch(() => null);
        if (!link || link.code !== 0 || !link.data?.url) {
            continue;
        }
        const kbps = parseKbps(link.data.kbps);
        const total = await fetchContentTotal(link.data.url);
        if (!total || !kbps) {
            // 拿到直链但测不出长度，返回可播但长度未知
            return { playable: 0, hasUrl: true };
        }
        return { playable: (total * 8) / (kbps * 1000), hasUrl: true };
    }
    return { playable: 0, hasUrl: false };
}

/** 目录里声明的文件大小换算成秒，实测失败时兜底 */
function declaredLength(song) {
    const sizes = [
        [Number(song?.size320 || 0), 320],
        [Number(song?.size128 || 0), 128],
    ];
    let best = 0;
    for (const [size, kbps] of sizes) {
        if (size > 0) {
            best = Math.max(best, (size * 8) / (kbps * 1000));
        }
    }
    return best;
}

/** 挑出真正能整轨播放的候选 */
async function pickFullTracks(candidates, origin) {
    const originDuration = Number(origin?.duration || 0);
    const originId = origin?.platform === PLATFORM ? String(origin?.id || '') : '';
    const ranked = candidates
        .filter((song) => song?.songmid && String(song.songmid) !== originId)
        .map((song) => ({ song, score: scoreCandidate(song, origin) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, ALTERNATIVE_PROBE_LIMIT);
    if (!ranked.length) {
        return [];
    }
    const measured = await mapWithLimit(
        ranked,
        ALTERNATIVE_PROBE_CONCURRENCY,
        (entry) => measurePlayableLength(String(entry.song.songmid)),
    );
    const full = [];
    ranked.forEach((entry, index) => {
        const song = entry.song;
        const probe = measured[index] || { playable: 0, hasUrl: false };
        // 拿不到音源的候选直接排除
        if (!probe.hasUrl) {
            return;
        }
        const playable = probe.playable > 0 ? probe.playable : declaredLength(song);
        // 测不出长度就不敢当成整轨，宁可漏也不错配
        if (playable <= 0) {
            return;
        }
        const selfDuration = Number(song.interval || 0);
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
            const item = toMusicItem(entry.song);
            if (!item) {
                return null;
            }
            item.isOriginArtist = artistMatchLevel(entry.song, origin) === 2;
            item.durationDelta = originDuration
                ? Math.round(Math.abs(Number(entry.song.interval || 0) - originDuration))
                : null;
            return item;
        })
        .filter(Boolean);
}


/* ---------------------------- 链接解析 ---------------------------- */

function extractSongMid(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    if (/^[0-9A-Za-z_-]{14}$/.test(text)) {
        return text;
    }
    const queryMatch = text.match(/[?&](?:songmid|id)=([^&#]+)/);
    if (queryMatch) {
        return decodeURIComponent(queryMatch[1]);
    }
    const pathMatch = text.match(/songDetail\/([0-9A-Za-z]+)/);
    return pathMatch ? pathMatch[1] : null;
}

function extractDissId(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    if (/^\d+$/.test(text)) {
        return text;
    }
    const queryMatch = text.match(/[?&](?:dissid|id)=(\d+)/);
    if (queryMatch) {
        return queryMatch[1];
    }
    const pathMatch = text.match(/playlist\/(\d+)/);
    return pathMatch ? pathMatch[1] : null;
}


module.exports = {
    platform: PLATFORM,
    version: '1.1.0',
    author: 'MusicFree',
    description: 'QQ音乐榜单与热门歌单：榜单分类浏览、歌单曲目、在线播放、歌词与完整版搜索',
    module: '榜单',
    defaultSearchType: 'music',
    supportedSearchType: ['music', 'album', 'artist', 'lyric'],
    primaryKey: ['title', 'artist'],
    hints: {
        importMusicSheet: [
            '支持 QQ音乐歌单链接或歌单 ID',
            '例如 https://y.qq.com/n/ryqq/playlist/7707261125',
        ],
        importMusicItem: [
            '支持 QQ音乐歌曲链接或歌曲 ID（songmid）',
            '例如 https://y.qq.com/n/ryqq/songDetail/002E3MtF0IAMMY',
        ],
    },
    userVariables: [
        {
            key: 'maxQuality',
            name: '最高音质',
            hint: 'low / standard / high / super，默认为 super',
        },
    ],

    async getTopLists() {
        return TOP_LISTS.map((group) => ({
            title: group.title,
            data: group.data.map((item) => ({
                id: item.id,
                platform: PLATFORM,
                title: item.title,
                artwork: item.artwork || '',
            })),
        }));
    },

    async getTopListDetail(topListItem, page) {
        const id = topListItem?.id;
        if (!id) {
            return { topListItem: topListItem || {}, musicList: [], isEnd: true };
        }
        const { info, songs } = await fetchTopListSongs(id);
        const musicList = songs.map(toMusicItem).filter(Boolean);
        const { musicList: currentList, isEnd } = paginate(musicList, page, DETAIL_PAGE_SIZE);
        const description = String(info.info || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim();
        return {
            topListItem: {
                ...topListItem,
                title: info.ListName || topListItem.title,
                artwork: toHttps(info.pic || '') || topListItem.artwork || '',
                description,
                playCount: Number(info.listennum) || 0,
                worksNum: musicList.length,
            },
            musicList: currentList,
            isEnd,
        };
    },

    async getRecommendSheetTags() {
        const tags = SHEET_SORT_TAGS.map((tag) => ({ id: tag.id, title: tag.title }));
        return {
            pinned: tags,
            data: [{ title: '歌单排序', data: tags }],
        };
    },

    async getRecommendSheetsByTag(tag, page) {
        const current = Math.max(1, Number(page) || 1);
        const sortId = String(tag?.id || '').trim() || SHEET_SORT_TAGS[0].id;
        const { list, total, next } = await fetchSheetList(sortId, current);
        return {
            data: list.map(toSheetItem).filter(Boolean),
            isEnd: list.length === 0 || next >= total,
        };
    },

    async getMusicSheetInfo(sheetItem, page) {
        const id = sheetItem?.id;
        if (!id) {
            return { sheetItem: sheetItem || {}, musicList: [], isEnd: true };
        }
        const current = Math.max(1, Number(page) || 1);
        const tracks = await fetchSheetTracks(id);
        const start = (current - 1) * DETAIL_PAGE_SIZE;
        const musicList = await enrichTracks(tracks.slice(start, start + DETAIL_PAGE_SIZE));
        return {
            sheetItem: {
                ...sheetItem,
                worksNum: tracks.length,
            },
            musicList,
            isEnd: start + DETAIL_PAGE_SIZE >= tracks.length,
        };
    },

    async getMediaSource(musicItem, quality) {
        const mid = musicItem?.id;
        if (!mid) {
            throw new Error('缺少歌曲 ID');
        }
        let target = QUALITY_ORDER.includes(quality) ? quality : 'standard';
        const maxQuality = String(getUserVariables().maxQuality || '').trim();
        if (QUALITY_ORDER.includes(maxQuality)) {
            const limit = QUALITY_ORDER.indexOf(maxQuality);
            if (QUALITY_ORDER.indexOf(target) > limit) {
                target = maxQuality;
            }
        }
        const source = await fetchMediaUrl(String(mid), target);
        if (!source) {
            throw new Error('该歌曲暂无音源');
        }
        return {
            url: source.url,
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://y.qq.com/',
            },
            quality: VKEYS_QUALITY_KEY[source.level] || target,
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
        let alive = false;
        const collect = (list) => {
            for (const song of list) {
                const mid = String(song?.songmid || '');
                if (!mid) {
                    continue;
                }
                if (collected.has(mid)) {
                    collected.set(mid, { ...collected.get(mid), ...song });
                } else {
                    collected.set(mid, song);
                }
            }
        };

        for (const query of buildAlternativeQueries(title, artist)) {
            const list = await searchSongs(query, ALTERNATIVE_QUERY_LIMIT);
            if (list.length) {
                alive = true;
            }
            collect(list);
        }

        // 前几轮没搜到同名同歌手时，再单独用歌手名搜一轮，
        // 歌手名检索会带进大量无关歌曲，靠歌名过滤兜住。
        const hasOrigin = Array.from(collected.values()).some(
            (song) =>
                titleMatchLevel(title, song.songname) >= 2 &&
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
            (song) => titleMatchLevel(title, song.songname) > 0,
        );
        if (!candidates.length) {
            candidates = all;
        }

        // 检索词换过了，比对时也按新歌名来，原曲的 id/歌手/时长不变
        const data = await pickFullTracks(candidates, { ...musicItem, title });
        return {
            isEnd: true,
            data: data.slice(0, ALTERNATIVE_LIMIT),
        };
    },

    async getLyric(musicItem) {
        const mid = musicItem?.id;
        if (!mid) {
            throw new Error('缺少歌曲 ID');
        }
        const data = await getJson(LYRIC_API, {
            songmid: String(mid),
            format: 'json',
            nobase64: 1,
            g_tk: 5381,
        }).catch(() => null);
        const rawLrc = data?.lyric || '';
        const translation = data?.trans || '';
        if (isUsableLyric(rawLrc)) {
            return { rawLrc: cleanLyricHeader(rawLrc), translation };
        }
        const fallback = await fetchLrclibLyric(musicItem?.title, musicItem?.artist);
        if (fallback) {
            return fallback;
        }
        if (rawLrc.trim() || translation.trim()) {
            return { rawLrc: cleanLyricHeader(rawLrc), translation };
        }
        return { rawLrc: NO_LYRIC_LRC, translation: '' };
    },

    async search(query, page, type) {
        const keyword = String(query ?? '').trim();
        if (!keyword) {
            return { data: [], isEnd: true };
        }
        const current = Math.max(1, Number(page) || 1);

        if (type === 'album' || type === 'artist') {
            const data = await getJson(SMARTBOX_API, {
                key: keyword,
                format: 'json',
                inCharset: 'utf8',
                outCharset: 'utf-8',
            }).catch(() => null);
            // smartbox 的分区键：专辑是 album，歌手是 singer
            const section = data?.data?.[type === 'artist' ? 'singer' : 'album'] || {};
            const list = section.itemlist || [];
            const items = list.map(type === 'album' ? toAlbumItem : toArtistItem).filter(Boolean);
            return { data: items, isEnd: true };
        }

        const offset = (current - 1) * SEARCH_PAGE_SIZE;
        const data = await getJson(SEARCH_API, {
            p: current,
            n: SEARCH_PAGE_SIZE,
            w: keyword,
            t: 0,
            format: 'json',
        }).catch(() => null);
        const section = data?.data?.song || {};
        const list = section.list || [];
        const total = Number(section.totalnum) || 0;
        const items = list.map(toMusicItem).filter(Boolean);
        return {
            data: items,
            isEnd: items.length === 0 || offset + items.length >= total,
        };
    },

    async importMusicItem(urlLike) {
        const mid = extractSongMid(urlLike);
        if (!mid) {
            throw new Error('无法识别的歌曲链接或 ID');
        }
        const meta = await fetchSongMeta(mid);
        const musicItem = toMusicItemFromMeta(meta, { mid });
        if (!musicItem) {
            throw new Error('未找到该歌曲');
        }
        return musicItem;
    },

    async importMusicSheet(urlLike) {
        const dissid = extractDissId(urlLike);
        if (!dissid) {
            throw new Error('无法识别的歌单链接或 ID');
        }
        const tracks = await fetchSheetTracks(dissid);
        if (!tracks.length) {
            throw new Error('歌单为空，或该歌单需要登录后才能访问');
        }
        const musicList = await enrichTracks(tracks);
        if (!musicList.length) {
            throw new Error('歌单为空，或该歌单需要登录后才能访问');
        }
        return musicList;
    },
};
