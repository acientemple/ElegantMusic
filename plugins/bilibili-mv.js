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

/** 一次 MV 候选检索用的关键词上限，太多会拖慢弹窗 */
const CANDIDATE_KEYWORD_LIMIT = 12;
/** 排在前面的关键词多翻一页，命中率高的多看几页 */
const CANDIDATE_DEEP_KEYWORDS = 4;
/** 并发请求上限，避免把 B 站打出风控 */
const CANDIDATE_CONCURRENCY = 6;
/** 一次最多给多少条候选 */
const CANDIDATE_LIMIT = 20;
/** 音乐分区 tid：B 站的 MV 都挂在音乐区，限定分区能滤掉综艺、游戏这类蹭热度结果 */
const MUSIC_TID = 3;

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

/** durl 的画质 id：16=360P 32=480P 64=720P 80=1080P（durl 没有 4K） */
const DOWNLOAD_QUALITY_LEVELS = {
    low: 32,
    standard: 64,
    high: 80,
    super: 80,
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

/** 文件名里不能有的字符 */
function sanitizeFileName(name) {
    return String(name || '')
        .replace(/[/\\?*"<>:|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
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

/**
 * 歌名比对用的键，要去掉修饰。
 * 「光年之外 (Live)」的 MV 标题往往只写「光年之外」，
 * 不去掉修饰的话谁也匹配不上。
 */
function songKey(title) {
    return normalizeText(stripDecorations(title)) || normalizeText(title);
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
    if (!artist || artist.length < 2) {
        return false;
    }
    return normalizeText(stripHtml(video?.title)).includes(artist);
}

/** 有没有明确的 MV 信号：分区是 MV，或者标题/标签里写着 MV、官方、完整版 */
function hasMvSignal(video) {
    if (String(video?.typename || '') === 'MV') {
        return true;
    }
    const title = stripHtml(video?.title);
    const haystack = `${title} ${String(video?.tag || '')}`;
    // 词边界是为了放过「AMV」「MV4」这类蹭词
    if (/\bM\/?V\b|\bmusic\s+video\b/i.test(haystack)) {
        return true;
    }
    // 官方 MV 常常只写歌名，靠「官方」「完整版」这类字样认
    return /官方|完整版|正版/.test(title);
}

/** MV 相关度打分，用来把真正的 MV 排到前面 */
function scoreMv(video, artistKey) {
    const title = stripHtml(video.title);
    const tags = String(video.tag || '');
    const area = String(video.typename || '');
    const haystack = `${title} ${tags}`;
    let score = 0;
    if (area === 'MV') {
        score += 60;
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
    // 歌手名写在标题里，说明就是这首歌的 MV
    if (titleHasArtist(video, artistKey)) {
        score += 40;
    }
    if (/官方/.test(haystack)) {
        score += 30;
    }
    if (/官方\s*MV|正版\s*MV|音乐录影带/i.test(haystack)) {
        score += 20;
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

/* --------------------------- MV 候选检索 --------------------------- */

/** 去掉歌名里的括号修饰，如「光年之外 (Live)」→「光年之外」 */
function stripDecorations(text) {
    return String(text || '')
        .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 歌手名写法很杂（「G.E.M.邓紫棋」「邓紫棋/G.E.M」），逐个变体都试一遍 */
function artistVariants(artist) {
    const text = String(artist || '').trim();
    if (!text) {
        return [];
    }
    const parts = text
        .split(/[/、,&·;|]+/)
        .map((it) => it.trim())
        .filter(Boolean);
    const list = [text, ...parts];
    // 「G.E.M.邓紫棋」去掉点号也是常见写法
    const noDot = text.replace(/[.\s·]+/g, '');
    if (noDot) {
        list.push(noDot);
    }
    return Array.from(new Set(list.filter((it) => it.length >= 2)));
}

/**
 * 检索词矩阵。
 * 官方 MV 的标题跟歌曲名对不上是「搜不到」的主因，
 * 所以歌名去掉修饰、歌手名换写法、MV/官方/完整版等修饰词都要各试一遍。
 */
function buildCandidateKeywords(title, artist, hints) {
    const raw = String(title || '').trim();
    const clean = stripDecorations(raw) || raw;
    const list = [];
    const push = (text) => {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value && !list.includes(value)) {
            list.push(value);
        }
    };
    const artists = artistVariants(artist);
    const mainArtist = artists[0] || '';
    if (clean && mainArtist) {
        push(`${clean} ${mainArtist}`);
    }
    if (raw && mainArtist && raw !== clean) {
        push(`${raw} ${mainArtist}`);
    }
    if (clean) {
        push(`${clean} MV`);
        push(clean);
        push(`${clean} 官方MV`);
        push(`${clean} 完整版`);
        push(`${clean} 现场版`);
    }
    if (raw && raw !== clean) {
        push(raw);
    }
    artists.slice(1).forEach((name) => {
        if (clean) {
            push(`${clean} ${name}`);
        }
    });
    // 线索源给的检索词兜底，优先级最低
    (hints || []).forEach((hint) => push(hint.keyword));
    return list.slice(0, CANDIDATE_KEYWORD_LIMIT);
}

/** 网易云的 MV 搜索，借它的官方 MV 标题当线索 */
async function fetchNeteaseMvTitles(keyword) {
    const data = await requestJson(
        `https://music.163.com/api/search/get?type=1014&s=${encodeURIComponent(
            keyword,
        )}&limit=10&offset=0`,
        {
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://music.163.com/',
            },
        },
    );
    return (data?.result?.videos || [])
        .map((item) => ({
            title: String(item?.title || '').trim(),
            singer: String(item?.artistName || '').trim(),
        }))
        .filter((item) => item.title);
}

/** 酷狗的 MV 搜索，同样借官方 MV 标题 */
async function fetchKugouMvTitles(keyword) {
    const data = await requestJson(
        `https://mobileservice.kugou.com/api/v3/search/mv?keyword=${encodeURIComponent(
            keyword,
        )}&page=1&pagesize=10`,
        {
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://www.kugou.com/',
            },
        },
    );
    return (data?.data?.info || [])
        .map((item) => ({
            title: String(item?.filename || '').trim(),
            singer: String(item?.singername || '').trim(),
        }))
        .filter((item) => item.title);
}

/**
 * 括号里只剩这些通用词时没什么检索价值，
 * 全是这类词就直接丢掉，不然会把一堆不相干的视频标成官方 MV。
 */
const GENERIC_HINT_WORDS = [
    'live',
    'official',
    'video',
    'visual',
    'mv',
    'cover',
    'by',
    'remix',
    'mix',
    'club',
    'feat',
    'ft',
    'remaster',
    '官方',
    '完整版',
    '现场版',
    '现场',
    '动态歌词',
    'hi-res',
    'hires',
    '无损',
    '主题曲',
    '宣传曲',
    '电影',
    '电影版',
    '电视剧',
    '预告',
    '纯享',
    '演唱会',
    '动漫',
    '版',
    'lyric',
    'lyrics',
    'song',
    'clip',
    'version',
    'instrumental',
    'mono',
    'stereo',
    'music video',
];

/**
 * 标题里明确写着官方出品 / MV 字样的，才算官方 MV。
 * 用词边界是为了放过「AMV」「Lyric Video」这类蹭词的视频。
 */
const OFFICIAL_TITLE_RE =
    /官方|正版|音乐录影带|\bofficial\b|\bm\/?v\b|\bmusic\s+video\b/i;

/** 翻唱、教程、钢琴改编这类二次创作，官方 MV 角标不能落到它们头上 */
const NON_OFFICIAL_TITLE_RE =
    /翻唱|\bcover\b|remix|reaction|舞蹈|\bdance\b|piano|钢琴|纯享|演示|教程|tutorial|填词|歌词版|lyric\s*video|AI制作|AI修复|AI高清|背景视频|背景素材|模板素材|自制|混剪|鬼畜/i;

/**
 * 把线索拆成不含通用词的片段。
 * 「太空旅客 电影中国区主题曲」里只有「太空旅客」这种片段有区分度，
 * 「电影」「主题曲」到处都有，拿去判定只会误标。
 */
function splitHintKeys(piece) {
    let rest = String(piece || '').toLowerCase();
    for (const word of GENERIC_HINT_WORDS) {
        rest = rest.split(word).join(' ');
    }
    return rest
        .split(/[\s,，、·|/\\:：;；\-—_]+/)
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

/**
 * 片段里带着歌名或歌手名的，说明它只是这首歌本身，不是独有线索。
 * 拿这种片段去判定官方 MV，任何提到这首歌的视频都会被误标。
 */
function isSongRelatedKey(key, songNorm, artistNorm) {
    if (!key) {
        return true;
    }
    if (songNorm && (key === songNorm || key.includes(songNorm) || songNorm.includes(key))) {
        return true;
    }
    if (artistNorm) {
        const parts = artistNorm
            .split(/[^\p{L}\p{N}]+/u)
            .filter((part) => part.length >= 2);
        if (parts.some((part) => key.includes(part) || part.includes(key))) {
            return true;
        }
    }
    return false;
}

/**
 * 官方 MV 的标题里常有「《太空旅客》电影中国区主题曲」这类独有线索，
 * 去掉括号就把它丢了。把括号里的内容单独抽出来当检索词。
 */
function extractHintKeywords(titles, songTitle, songArtist) {
    const clean = stripDecorations(songTitle) || String(songTitle || '').trim();
    const songNorm = normalizeText(clean);
    const artistNorm = normalizeText(songArtist || '');
    const hints = [];
    const seen = new Set();
    for (const item of titles) {
        const title = String(item?.title || '');
        const re = /[（(【\[]\s*([^）)】\]]{2,40}?)\s*[）)】\]]/g;
        let matched;
        while ((matched = re.exec(title))) {
            const piece = matched[1]
                .replace(/[《》"'“”]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (piece.length < 2) {
                continue;
            }
            // 全是通用词就没有区分度，别拿来当判定依据
            const keys = splitHintKeys(piece).filter(
                (key) =>
                    key.length >= 2 &&
                    !isSongRelatedKey(key, songNorm, artistNorm),
            );
            if (!keys.length) {
                continue;
            }
            const fingerprint = keys.join(' ');
            if (seen.has(fingerprint)) {
                continue;
            }
            seen.add(fingerprint);
            hints.push({keyword: `${clean} ${piece}`, piece, keys});
        }
    }
    return hints.slice(0, 4);
}

/** 借网易云、酷狗的官方 MV 标题当检索线索，取不到就静默降级 */
async function collectMvHints(title, artist) {
    const keyword = stripDecorations(title) || String(title || '').trim();
    if (!keyword) {
        return [];
    }
    const [netease, kugou] = await Promise.all([
        fetchNeteaseMvTitles(keyword).catch(() => []),
        fetchKugouMvTitles(keyword).catch(() => []),
    ]);
    const artistKey = normalizeText(artist);
    const picked = artistKey
        ? kugou.filter((item) => normalizeText(item.singer).includes(artistKey))
        : kugou;
    return extractHintKeywords([...netease, ...picked], keyword, artist);
}

/** 并发跑一批任务，避免一次打太多请求出去 */
async function mapWithLimit(items, limit, worker) {
    const results = [];
    let index = 0;
    const runner = async () => {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current], current);
        }
    };
    const size = Math.max(1, Math.min(limit, items.length));
    await Promise.all(new Array(size).fill(0).map(() => runner()));
    return results;
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
    // 官方 MV 常带片头片尾，比单曲长不少；阈值太紧会把正片误杀
    if (duration < song * 0.5) {
        return false;
    }
    if (duration > song * 4) {
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
        // 标题命中了官方 MV 的独有线索
        isOfficialMv: video.officialHint === true,
    };
}

async function searchVideos(keyword, page, extra) {
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
            ...(extra || {}),
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
    version: '1.2.0',
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

    /**
     * 下载地址。
     * DASH 把音视频拆成两个文件，单独存下来只有画面没有声音；
     * durl（fnval=1）返回的是音视频合一的 mp4，才能存成能看的视频。
     */
    async getVideoDownloadSource(musicItem, quality) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        const info = await fetchVideoInfo(bvid);
        const aid = info?.aid;
        const cid = info?.cid;
        if (!aid || !cid) {
            throw new Error('未找到视频分P信息');
        }
        const qn = DOWNLOAD_QUALITY_LEVELS[quality] ?? 64;
        const data = await requestJson(
            `https://api.bilibili.com/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=1&fourk=1&platform=html5&high_quality=1`,
            {headers: baseHeaders({referer: `https://www.bilibili.com/video/${bvid}/`})},
        );
        if (data?.code !== 0) {
            throw new Error(data?.message || '无法获取下载地址');
        }
        const durl = data?.data?.durl?.[0];
        if (!durl?.url) {
            throw new Error('该视频没有可下载的文件');
        }
        return {
            url: toHttps(durl.url),
            headers: streamHeaders(),
            filename: `${sanitizeFileName(info?.title || musicItem?.title || bvid)}.mp4`,
            size: durl.size,
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
     * 官方 MV 常常不带 "MV" 字样，标题也未必带歌手名，
     * 所以检索词要覆盖歌名修饰、歌手写法、MV/官方等修饰，再借网易云、酷狗的官方 MV 标题补线索；
     * 候选的 id 是 BV 号，被选中后可以直接交给 getVideoSource 取流。
     */
    async getMusicVideoCandidates(musicItem, page, keyword) {
        // 用户可以在界面上改检索词，改了就按他给的词找
        const custom = String(keyword ?? '').trim();
        const title = String(musicItem?.title ?? '').trim();
        const artist = String(musicItem?.artist ?? '').trim();
        if (!custom && !title) {
            return {isEnd: true, data: []};
        }
        const current = Math.max(1, Number(page) || 1);
        const songDuration = Number(musicItem?.duration);

        let hints = [];
        let keywords;
        if (custom) {
            // 自定义检索词：直接按这个词搜
            keywords = [custom, `${custom} MV`, `${custom} 官方MV`].filter(
                (item, index, list) => list.indexOf(item) === index,
            );
        } else {
            // 官方 MV 的正式标题常带「电影中国区主题曲」这类唯一线索，借网易云、酷狗的搜索结果当检索词
            hints = await collectMvHints(title, artist);
            keywords = buildCandidateKeywords(title, artist, hints);
        }

        // 检索任务：靠前的关键词多翻一页，MV 所在的音乐分区再定向搜一轮
        const tasks = [];
        keywords.forEach((keyword, index) => {
            tasks.push({keyword, page: current});
            if (index < CANDIDATE_DEEP_KEYWORDS) {
                tasks.push({keyword, page: current === 2 ? 1 : 2});
            }
        });
        if (keywords.length) {
            tasks.push({keyword: keywords[0], page: current, tid: MUSIC_TID});
            tasks.push({keyword: keywords[0], page: current === 2 ? 1 : 2, tid: MUSIC_TID});
        }

        const resultLists = await mapWithLimit(
            tasks,
            CANDIDATE_CONCURRENCY,
            async (task) => {
                try {
                    return await searchVideos(
                        task.keyword,
                        task.page,
                        task.tid ? {tids: task.tid} : undefined,
                    );
                } catch (e) {
                    return [];
                }
            },
        );

        const seen = new Set();
        const merged = [];
        for (const results of resultLists) {
            for (const video of results) {
                if (!video?.bvid || seen.has(video.bvid)) {
                    continue;
                }
                seen.add(video.bvid);
                if (isSingleMv(video) && (custom || isFullLength(video, songDuration))) {
                    merged.push(video);
                }
            }
        }
        // 标题里没有歌名的多半是蹭热度，宁可没有也不要给一堆不相干的
        const song = songKey(title);
        const artistKey = normalizeText(artist);
        let matched;
        if (custom) {
            // 自定义检索词：搜出来的就是用户要找的，按相关度排
            matched = merged;
        } else {
            const named = merged.filter((video) => titleHasSong(video, song));
            // 歌手名在标题里是强信号；官方 MV 常常只写歌名，没有歌手线索但有 MV 信号（分区=MV、标题带官方、完整版）也留下
            const withArtist = named.filter((video) => titleHasArtist(video, artistKey));
            const withSignal = named.filter((video) => hasMvSignal(video));
            // 歌手名缺失时只有足够独特的歌名才放宽，否则「Lemon」这种会召回一堆无关歌
            const relaxed = isDistinctSong(song) ? withSignal : [];
            matched = [...withArtist, ...relaxed].filter(
                (video, index, list) =>
                    list.findIndex((item) => item.bvid === video.bvid) === index,
            );
        }
        const scored = matched
            .map((video) => ({video, score: scoreMv(video, artistKey)}))
            .sort((a, b) => b.score - a.score);
        // 分数为负的基本都是凑数的，有好货的时候不必展示
        const good = scored.filter((item) => item.score > 0);
        const picked = (custom ? scored : good.length ? good : scored).slice(
            0,
            CANDIDATE_LIMIT,
        );
        // 标题命中官方 MV 的独有线索的，给个标记
        // 太短的片段（如「对唱」）到处都有，命中了也说明不了什么
        const hintKeys = hints
            .flatMap((hint) => hint.keys || [])
            .filter((key) => key.length >= 3);
        const data = picked
            .map((item) => {
                const rawTitle = stripHtml(item.video.title);
                const videoTitle = normalizeText(rawTitle);
                // 命中线索片段，或者标题里直接写着官方出品，都算官方 MV
                const official =
                    !NON_OFFICIAL_TITLE_RE.test(rawTitle) &&
                    (OFFICIAL_TITLE_RE.test(rawTitle) ||
                        hintKeys.some((key) => videoTitle.includes(key)));
                if (official) {
                    item.video.officialHint = true;
                }
                return toMusicItem(item.video);
            })
            .filter(Boolean);
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
