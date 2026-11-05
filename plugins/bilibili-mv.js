/**
 * 哔哩哔哩MV —— 搜索并播放 B 站上的音乐视频（MV）
 *
 * 数据来源（均为 B 站网页端真实接口）：
 *  - 搜索：api.bilibili.com/x/web-interface/wbi/search/type（WBI 签名）
 *  - 播放信息：www.bilibili.com/video/{bvid}/ 页面内联的 window.__playinfo__
 *  - 字幕：api.bilibili.com/x/player/wbi/v2
 *
 * 播放说明：
 *  B 站的视频流是分片 fMP4（.m4s），单文件即可被浏览器解码，
 *  未登录最高 480P，配置 Cookie 后可拿到 1080P / 4K。
 */

const axios = require('axios');
const CryptoJS = require('crypto-js');

const PLATFORM = '哔哩哔哩MV';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SEARCH_PAGE_SIZE = 20;
const REQUEST_TIMEOUT = 8000;
const MIXIN_KEY_TTL = 60 * 60 * 1000;
const VIDEO_CACHE_TTL = 3 * 60 * 1000;
const VIDEO_CACHE_MAX = 30;

/** 单曲 MV 的时长上限，超过多半是合集或长视频 */
const MAX_DURATION = 15 * 60;

/** 标题/标签里出现这些词的多半不是单曲 MV */
const EXCLUDE_WORDS = [
    '合集', '全集', '合辑', '大盘点', '盘点', '歌单', '连播', '集锦', '混剪',
    '伴奏', '纯音乐', '钢琴版', '吉他版', '钢琴谱', '歌词排版', '直播回放', '录屏',
    '鼓谱', '琴谱', '谱子', '音高', '鬼畜', '吉他', '古筝', '二胡', 'KTV',
];

/** 蹭热度的营销词，只查标题；B 站的 tag 里有「经典」「怀旧」这类无害标签，查 tag 会误杀 */
const TITLE_EXCLUDE_WORDS = [
    '网络神曲', '神曲', '经典回顾', '回顾', '撕心裂肺', '听哭', '唱哭', '心碎',
    '车载', '劲爆', '嗨起来', 'DJ舞曲', '助眠', '睡前', '热歌', '必听', '大全',
    '伤感歌曲', '经典老歌',
];

/** 搬运号的 UP 主特征，这类号发的基本是拼凑视频 */
const EXCLUDE_AUTHORS = ['情感音乐', '影视音乐', '热门音乐', '音像'];

/** 分区跟 MV 无关的扣分，扣得狠的基本是蹭热度 */
const AREA_PENALTY = {
    综艺: -30,
    明星综合: -30,
    日常: -10,
    手机游戏: -40,
    知识: -30,
    影视: -30,
    游戏: -40,
    动画: -30,
    演奏: -40,
    乐评盘点: -40,
    音乐现场: -15,
    电台: -25,
    热点: -30,
    电子竞技: -40,
    音乐教学: -30,
    翻唱: -25,
    VOCALOID: -40,
    音MAD: -30,
    绘画: -30,
    手书: -30,
    资讯: -30,
    音乐综合: -12,
};

/** 现场版、歌词版之类，比官方 MV 低一等 */
const DEMOTE_RULES = [
    {re: /\bLive\b/i, score: -35},
    {re: /现场|演唱会/, score: -20},
    {re: /翻唱|降调/, score: -20},
    {re: /戏腔版|戏曲版|Remix/i, score: -20},
    {re: /DJ\s*版/i, score: -25},
    {re: /手语|清唱|吟唱/, score: -20},
    {re: /音高|人声版/, score: -20},
    {re: /动态歌词|歌词版|歌词排版/, score: -12},
    {re: /录音棚|Hi-?Fi|环绕|耳机福利/, score: -8},
];

/** 画质 id：16=360P 32=480P 64=720P 80=1080P 116=1080P60 120=4K */
const QUALITY_LEVELS = {
    low: [16, 32],
    standard: [32, 16],
    high: [64, 32, 16],
    super: [120, 116, 80, 64, 32, 16],
};

/** 音质 id：30216=64K 30232=132K 30280=192K（B 站 DASH 音轨是独立文件） */
const AUDIO_QUALITY_LEVELS = {
    low: [30216],
    standard: [30232, 30216],
    high: [30280, 30232, 30216],
    super: [30280, 30232, 30216],
};

/** 编码兼容性：avc1 最稳，其次 hev1，最后 av01 */
const CODEC_RANK = (codecs) => {
    if (/avc1/i.test(codecs || '')) return 0;
    if (/hev1/i.test(codecs || '')) return 1;
    if (/av01/i.test(codecs || '')) return 2;
    return 3;
};

// B 站 WBI 签名密钥置换表
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9,
    42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1,
    60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let mixinKeyCache = {value: '', time: 0};
const videoCache = new Map();

/** 翻页时用来去掉上一页已经出现过的条目 */
const searchedIds = new Set();

function getUserVariables() {
    try {
        return env.getUserVariables() || {};
    } catch (e) {
        return {};
    }
}

function getLoginCookie() {
    return String(getUserVariables().cookie || '').trim();
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        // B 站搜索结果会把撇号之类编码成 &#x27;，不解码的话歌名永远匹配不上
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
            String.fromCodePoint(Number.parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
}

function toHttps(url) {
    if (typeof url !== 'string' || !url) {
        return '';
    }
    if (url.startsWith('//')) {
        return 'https:' + url;
    }
    return url.replace(/^http:\/\//, 'https://');
}

function parseDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.round(value);
    }
    const text = String(value || '');
    const matched = text.match(/(\d+):(\d+)/);
    if (matched) {
        return Number(matched[1]) * 60 + Number(matched[2]);
    }
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}

async function request(url, options) {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        ...(options || {}),
    });
    return response.data;
}

function parseJson(data) {
    if (typeof data !== 'string') {
        return data;
    }
    try {
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

async function requestJson(url, options) {
    return parseJson(await request(url, options));
}

function baseHeaders(extra) {
    const headers = {
        'user-agent': USER_AGENT,
        referer: 'https://www.bilibili.com/',
        origin: 'https://www.bilibili.com',
        ...(extra || {}),
    };
    const cookie = getLoginCookie();
    if (cookie) {
        headers.cookie = cookie;
    }
    return headers;
}

/** WBI 密钥：nav 接口返回的两张图片文件名按置换表重排 */
function getMixinKeyFrom(imgUrl, subUrl) {
    const raw =
        String(imgUrl || '').split('/').pop().split('.')[0] +
        String(subUrl || '').split('/').pop().split('.')[0];
    return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
}

async function getMixinKey() {
    if (mixinKeyCache.value && Date.now() - mixinKeyCache.time < MIXIN_KEY_TTL) {
        return mixinKeyCache.value;
    }
    const data = await requestJson('https://api.bilibili.com/x/web-interface/nav', {
        headers: baseHeaders(),
    });
    const wbi = data?.data?.wbi_img;
    if (!wbi?.img_url || !wbi?.sub_url) {
        throw new Error('无法获取 B 站签名密钥');
    }
    const key = getMixinKeyFrom(wbi.img_url, wbi.sub_url);
    mixinKeyCache = {value: key, time: Date.now()};
    return key;
}

/** 完整手工拼串：w_rid 依赖参数顺序，交给 axios 二次编码会破坏签名 */
function buildSignedQuery(params, mixinKey) {
    const merged = {...params, wts: Math.floor(Date.now() / 1000)};
    const query = Object.keys(merged)
        .sort()
        .map((key) => {
            const value = String(merged[key] === undefined ? '' : merged[key]).replace(
                /[!'()*]/g,
                '',
            );
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
    return `${query}&w_rid=${CryptoJS.MD5(query + mixinKey).toString()}`;
}

/** 从 HTML 中截取某个标记之后的第一段完整 JSON */
function extractJsonAfter(text, marker) {
    const raw = String(text || '');
    const index = raw.indexOf(marker);
    if (index < 0) {
        return null;
    }
    const start = raw.indexOf('{', index);
    if (start < 0) {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(raw.slice(start, i + 1));
                } catch (e) {
                    return null;
                }
            }
        }
    }
    return null;
}

function extractVideoData(html) {
    const stateIndex = html.indexOf('window.__INITIAL_STATE__');
    const from = stateIndex >= 0 ? stateIndex : 0;
    const keyIndex = html.indexOf('"videoData"', from);
    if (keyIndex >= 0) {
        const direct = extractJsonAfter(html.slice(keyIndex), '"videoData"');
        if (direct && direct.bvid) {
            return direct;
        }
    }
    const state = extractJsonAfter(html, 'window.__INITIAL_STATE__');
    return state?.videoData || null;
}

/** 视频页需要设备标识才会内联 __playinfo__ */
async function getBuvidCookie() {
    const data = await requestJson('https://api.bilibili.com/x/frontend/finger/spi_v2', {
        headers: baseHeaders(),
    });
    const b3 = data?.data?.b_3;
    if (!b3) {
        throw new Error('无法获取 B 站设备标识');
    }
    return `buvid3=${b3}; buvid4=${data?.data?.b_4 || ''}`;
}

async function fetchVideoPage(bvid) {
    const cached = videoCache.get(bvid);
    if (cached && Date.now() - cached.time < VIDEO_CACHE_TTL) {
        return cached.value;
    }
    const buvid = await getBuvidCookie();
    const loginCookie = getLoginCookie();
    const cookie = loginCookie ? `${buvid}; ${loginCookie}` : buvid;
    const html = await request(`https://www.bilibili.com/video/${bvid}/`, {
        headers: baseHeaders({cookie, 'accept-language': 'zh-CN,zh;q=0.9'}),
    });
    const value = {
        playInfo: extractJsonAfter(String(html || ''), 'window.__playinfo__'),
        videoData: extractVideoData(String(html || '')),
    };
    videoCache.set(bvid, {value, time: Date.now()});
    if (videoCache.size > VIDEO_CACHE_MAX) {
        videoCache.delete(videoCache.keys().next().value);
    }
    return value;
}

/** 视频基础信息，走 view 接口比解析页面更稳 */
async function fetchVideoInfo(bvid) {
    const data = await requestJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        {headers: baseHeaders()},
    );
    if (data?.code !== 0) {
        throw new Error(data?.message || '未找到该视频');
    }
    return data?.data || null;
}

function extractBvid(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    const matched = text.match(/(BV[0-9A-Za-z]{10})/);
    return matched ? matched[1] : null;
}

/** 判断是不是单曲 MV：合集、伴奏这类一律不要 */
function isSingleMv(video) {
    const title = stripHtml(video.title);
    const tags = String(video.tag || '');
    const haystack = `${title} ${tags}`;
    if (EXCLUDE_WORDS.some((word) => haystack.includes(word))) {
        return false;
    }
    if (TITLE_EXCLUDE_WORDS.some((word) => title.includes(word))) {
        return false;
    }
    const author = String(video.author || '');
    if (EXCLUDE_AUTHORS.some((word) => author.includes(word))) {
        return false;
    }
    if (video.is_pay || video.is_charge_video) {
        return false;
    }
    const duration = parseDuration(video.duration);
    if (duration > MAX_DURATION) {
        return false;
    }
    return true;
}

/** 去掉空格标点，只留文字和数字，方便比较歌名 */
function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 歌名是不是中日韩文字，这类歌名组合相对独特 */
function isCjkSong(song) {
    return /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/.test(song);
}

/** 歌名够不够独特，够独特才允许在没有歌手线索时放宽匹配 */
function isDistinctSong(song) {
    return song.length >= 6 || isCjkSong(song);
}

/** 标题里有没有出现歌名 */
function titleHasSong(video, song) {
    return normalizeText(stripHtml(video?.title)).includes(song);
}

/** 标题里有没有出现歌手名；只看标题，标签里带艺人名不代表视频就是这歌的 */
function titleHasArtist(video, artist) {
    return normalizeText(stripHtml(video?.title)).includes(artist);
}

/** 有没有明确的 MV 信号：分区是 MV，或者标题/标签里写着 MV */
function hasMvSignal(video) {
    if (String(video?.typename || '') === 'MV') {
        return true;
    }
    const haystack = `${stripHtml(video?.title)} ${String(video?.tag || '')}`;
    return /MV|M\/V/i.test(haystack);
}

/** MV 相关度打分，用来把真正的 MV 排到前面 */
function scoreMv(video) {
    const title = stripHtml(video.title);
    const tags = String(video.tag || '');
    const area = String(video.typename || '');
    const haystack = `${title} ${tags}`;
    let score = 0;
    if (area === 'MV') {
        score += 50;
    }
    for (const [name, penalty] of Object.entries(AREA_PENALTY)) {
        if (area.includes(name)) {
            score += penalty;
            break;
        }
    }
    if (/(^|,)\s*MV\s*(,|$)/i.test(tags)) {
        score += 20;
    }
    if (/官方/.test(haystack)) {
        score += 25;
    }
    if (/原版\s*MV/i.test(haystack)) {
        score += 20;
    }
    if (/华语MV/i.test(tags)) {
        score += 15;
    }
    if (/(^|,)单曲(,|$)/.test(tags)) {
        score += 15;
    }
    if (/\bMV\b/i.test(title)) {
        score += 15;
    }
    if (/完整版|正版/.test(title)) {
        score += 12;
    }
    if (/歌词视频/.test(haystack)) {
        score += 8;
    }
    if (/Hi-?Res|无损|4K|1080P|超清/i.test(title)) {
        score += 5;
    }
    for (const rule of DEMOTE_RULES) {
        if (rule.re.test(haystack)) {
            score += rule.score;
        }
    }
    const play = Number(video.play);
    if (Number.isFinite(play) && play > 0) {
        score += Math.min(12, Math.log10(play) * 3);
    }
    return score;
}

/** 画面长度要跟歌曲差不多，太短是片段，太长多半是合集 */
function isFullLength(video, songDuration) {
    const song = Number(songDuration);
    if (!Number.isFinite(song) || song <= 0) {
        return true;
    }
    const duration = parseDuration(video.duration);
    if (!duration) {
        return true;
    }
    if (duration < song * 0.6) {
        return false;
    }
    if (duration > song * 3) {
        return false;
    }
    return true;
}

function toMusicItem(video) {
    if (!video || !video.bvid) {
        return null;
    }
    const title = stripHtml(video.title);
    const typename = video.typename || '';
    return {
        id: video.bvid,
        title: title || '未知视频',
        artist: video.author || '',
        album: typename === 'MV' ? '音乐录像带' : typename || '哔哩哔哩',
        artwork: toHttps(video.pic),
        duration: parseDuration(video.duration),
        // 扩展字段：后续方法直接复用
        aid: video.aid,
        arcurl: video.arcurl,
        width: video.width,
        height: video.height,
        isMv:
            typename === 'MV' ||
            /(^|,)\s*MV\s*(,|$)/i.test(String(video.tag || '')) ||
            video.forceMv === true,
    };
}

async function searchVideos(keyword, page) {
    const mixinKey = await getMixinKey();
    const queryString = buildSignedQuery(
        {
            search_type: 'video',
            keyword,
            page,
            page_size: SEARCH_PAGE_SIZE,
            order: 'totalrank',
            platform: 'pc',
            web_location: 1430654,
        },
        mixinKey,
    );
    const data = await requestJson(
        `https://api.bilibili.com/x/web-interface/wbi/search/type?${queryString}`,
        {headers: baseHeaders({referer: 'https://search.bilibili.com/'})},
    );
    if (!data) {
        throw new Error('B 站搜索接口返回异常');
    }
    if (data.code !== 0) {
        throw new Error(data.message || 'B 站搜索失败');
    }
    return data?.data?.result || [];
}

function pickVideoStream(videoList, quality) {
    const preference = QUALITY_LEVELS[quality] || QUALITY_LEVELS.standard;
    for (const id of preference) {
        const hits = videoList.filter((item) => Number(item.id) === id);
        if (!hits.length) {
            continue;
        }
        hits.sort((a, b) => CODEC_RANK(a.codecs) - CODEC_RANK(b.codecs));
        return hits[0];
    }
    return null;
}

/** 音轨选择：B 站 DASH 里音视频是分开的两个文件 */
function pickAudioStream(audioList, quality) {
    const preference = AUDIO_QUALITY_LEVELS[quality] || AUDIO_QUALITY_LEVELS.standard;
    for (const id of preference) {
        const hit = audioList.find((item) => Number(item.id) === id);
        if (hit) {
            return hit;
        }
    }
    return [...audioList].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0] || null;
}

function pickStreamUrl(stream) {
    const candidates = [
        stream.baseUrl,
        stream.base_url,
        ...(stream.backupUrl || []),
        ...(stream.backup_url || []),
    ].filter((url) => typeof url === 'string' && url);
    return toHttps(candidates[0] || '');
}

/** upos 线路会校验 Referer，缺了就 403 */
function streamHeaders() {
    return {
        'user-agent': USER_AGENT,
        referer: 'https://www.bilibili.com/',
    };
}

function toLrcTime(seconds) {
    const ms = Math.max(0, Math.floor(Number(seconds || 0) * 1000));
    const minute = Math.floor(ms / 60000);
    const second = Math.floor((ms % 60000) / 1000);
    const cent = Math.floor((ms % 1000) / 10);
    return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(cent).padStart(2, '0')}]`;
}

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无字幕';

module.exports = {
    platform: PLATFORM,
    version: '1.1.0',
    author: 'MusicFree',
    module: '搜索',
    defaultSearchType: 'music',
    // 歌词检索走视频检索，选中后由 getLyric 取回该视频的字幕
    supportedSearchType: ['music', 'lyric'],
    hints: {
        importMusicItem: [
            '支持 B 站视频链接或 BV 号',
            '例如 https://www.bilibili.com/video/BV1A3411J7HX/',
        ],
        importMusicSheet: [
            '支持 B 站视频链接或 BV 号，导入为单项列表',
            '例如 https://www.bilibili.com/video/BV1A3411J7HX/',
        ],
    },
    userVariables: [
        {
            key: 'cookie',
            name: 'Cookie',
            hint: '可选，登录 B 站后的完整 Cookie，填写后才能获取 1080P / 4K 画质与视频字幕',
        },
    ],

    async search(query, page, type) {
        const keyword = String(query ?? '').trim();
        if (!keyword) {
            return {isEnd: true, data: []};
        }
        const current = Math.max(1, Number(page) || 1);
        if (current === 1) {
            searchedIds.clear();
        }

        // 首页同时搜原词和原词+MV，官方 MV 常常不带 MV 字样
        const keywords = current === 1 ? [keyword, `${keyword} MV`] : [keyword];
        const merged = [];
        const seen = new Set();
        for (const item of keywords) {
            let results = [];
            try {
                results = await searchVideos(item, current);
            } catch (e) {
                if (merged.length === 0) {
                    throw e;
                }
                continue;
            }
            for (const video of results) {
                if (!video?.bvid || seen.has(video.bvid) || searchedIds.has(video.bvid)) {
                    continue;
                }
                seen.add(video.bvid);
                if (isSingleMv(video)) {
                    merged.push(video);
                }
            }
        }
        merged.forEach((video) => {
            if (searchedIds.size > 500) {
                searchedIds.clear();
            }
            searchedIds.add(video.bvid);
        });

        merged.sort((a, b) => scoreMv(b) - scoreMv(a));
        const data = merged.map(toMusicItem).filter(Boolean);
        return {
            data,
            isEnd: data.length === 0,
        };
    },

    /**
     * 播放地址。
     * B 站 DASH 把音视频拆成两个文件，播放器用的是 audio 元素，
     * 所以这里必须给音轨，给了视频轨会全程静音。
     */
    async getMediaSource(musicItem, quality) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        const {playInfo} = await fetchVideoPage(bvid);
        const dash = playInfo?.data?.dash;
        const audios = Array.isArray(dash?.audio) ? dash.audio.filter((a) => a && a.id) : [];
        const audio = pickAudioStream(audios, quality);
        if (audio) {
            const url = pickStreamUrl(audio);
            if (url) {
                return {url, headers: streamHeaders()};
            }
        }
        const durl = playInfo?.data?.durl || [];
        if (durl.length && durl[0]?.url) {
            return {url: toHttps(durl[0].url), headers: streamHeaders()};
        }
        const videos = Array.isArray(dash?.video) ? dash.video.filter((v) => v && v.id) : [];
        const video = pickVideoStream(videos, quality);
        if (video) {
            const url = pickStreamUrl(video);
            if (url) {
                return {url, headers: streamHeaders()};
            }
        }
        throw new Error('该视频没有可用的音频流');
    },

    /** 视频轨地址，供 MV 画面播放使用（音轨在 getMediaSource 里单独取） */
    async getVideoSource(musicItem, quality) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        const {playInfo} = await fetchVideoPage(bvid);
        const dash = playInfo?.data?.dash;
        const videos = Array.isArray(dash?.video) ? dash.video.filter((v) => v && v.id) : [];
        const stream = pickVideoStream(videos, quality);
        const url = stream ? pickStreamUrl(stream) : '';
        if (!url) {
            throw new Error('该视频没有可用的视频流');
        }
        return {
            url,
            headers: streamHeaders(),
            width: stream.width,
            height: stream.height,
        };
    },

    async getLyric(musicItem) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        try {
            const {videoData} = await fetchVideoPage(bvid);
            const cid = videoData?.cid;
            const aid = videoData?.aid;
            if (!cid || !aid) {
                throw new Error('未找到视频分P信息');
            }
            const data = await requestJson(
                `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
                {headers: baseHeaders({referer: `https://www.bilibili.com/video/${bvid}/`})},
            );
            const subtitles = data?.data?.subtitle?.subtitles || [];
            const target = subtitles.find((item) => item?.subtitle_url) || subtitles[0];
            if (!target?.subtitle_url) {
                throw new Error('该视频没有字幕');
            }
            const subtitle = await requestJson(toHttps(target.subtitle_url), {
                headers: baseHeaders({referer: `https://www.bilibili.com/video/${bvid}/`}),
            });
            const body = Array.isArray(subtitle?.body) ? subtitle.body : [];
            if (!body.length) {
                throw new Error('字幕内容为空');
            }
            const rawLrc = body
                .map((line) => `${toLrcTime(line.from)}${line.content || ''}`)
                .join('\n');
            return {rawLrc, translation: ''};
        } catch (e) {
            return {rawLrc: NO_LYRIC_LRC, translation: ''};
        }
    },

    async getMusicInfo(musicItem) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        const {videoData} = await fetchVideoPage(bvid);
        if (!videoData) {
            throw new Error('未找到该视频');
        }
        return {
            id: bvid,
            title: stripHtml(videoData.title),
            artist: videoData.owner?.name || '',
            artwork: toHttps(videoData.pic),
            duration: parseDuration(videoData.duration),
        };
    },

    /**
     * 按歌曲找 MV 候选。
     * 官方 MV 常常不带 "MV" 字样，所以同时搜「歌名 歌手」和「歌名 歌手 MV」；
     * 候选的 id 是 BV 号，被选中后可以直接交给 getVideoSource 取流。
     */
    async getMusicVideoCandidates(musicItem, page) {
        const title = String(musicItem?.title ?? '').trim();
        const artist = String(musicItem?.artist ?? '').trim();
        if (!title) {
            return {isEnd: true, data: []};
        }
        const current = Math.max(1, Number(page) || 1);
        const songDuration = Number(musicItem?.duration);
        // 官方 MV 常常只写歌名，所以歌名单独再搜一遍
        const keywords = [
            `${title} ${artist}`.trim(),
            `${title} ${artist} MV`.trim(),
            title,
        ];
        const seen = new Set();
        const merged = [];
        const resultLists = await Promise.all(
            keywords.map((keyword) =>
                searchVideos(keyword, current).catch(() => []),
            ),
        );
        for (const results of resultLists) {
            for (const video of results) {
                if (!video?.bvid || seen.has(video.bvid)) {
                    continue;
                }
                seen.add(video.bvid);
                if (isSingleMv(video) && isFullLength(video, songDuration)) {
                    merged.push(video);
                }
            }
        }
        // 标题里没有歌名的多半是蹭热度，宁可没有也不要给一堆不相干的
        const song = normalizeText(title);
        const artistKey = normalizeText(artist);
        const named = merged.filter((video) => titleHasSong(video, song));
        // 歌手名也在标题里才算对；否则「Hello」这种常见歌名会召回一堆儿歌、翻唱
        let matched = artistKey.length >= 2
            ? named.filter((video) => titleHasArtist(video, artistKey))
            : [];
        if (!matched.length && isDistinctSong(song)) {
            // 没有歌手线索时放宽，但只给明确带 MV 信号的视频
            matched = named.filter((video) => hasMvSignal(video));
        }
        const scored = matched
            .map((video) => ({video, score: scoreMv(video)}))
            .sort((a, b) => b.score - a.score);
        // 分数为负的基本都是凑数的，有好货的时候不必展示
        const good = scored.filter((item) => item.score > 0);
        const picked = (good.length ? good : scored).slice(0, 15);
        const data = picked.map((item) => toMusicItem(item.video)).filter(Boolean);
        return {
            isEnd: data.length === 0,
            data,
        };
    },

    async importMusicItem(urlLike) {
        const bvid = extractBvid(urlLike);
        if (!bvid) {
            throw new Error('无法识别的 B 站视频链接或 BV 号');
        }
        const info = await fetchVideoInfo(bvid);
        if (!info) {
            throw new Error('未找到该视频');
        }
        return toMusicItem({
            bvid: info.bvid,
            title: info.title,
            author: info.owner?.name,
            pic: info.pic,
            duration: info.duration,
            aid: info.aid,
            typename: info.tname,
            width: info.dimension?.width,
            height: info.dimension?.height,
            forceMv: true,
        });
    },

    async importMusicSheet(urlLike) {
        const bvid = extractBvid(urlLike);
        if (!bvid) {
            throw new Error('无法识别的 B 站视频链接或 BV 号');
        }
        const item = await this.importMusicItem(bvid);
        return [item];
    },
};
