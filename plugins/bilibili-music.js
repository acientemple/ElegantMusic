/**
 * 哔哩哔哩音乐 —— 按关键词搜索 B 站视频，抽取其音频流作为音源
 *
 * 数据来源（均为 B 站网页端真实接口）：
 *  - 搜索：api.bilibili.com/x/web-interface/wbi/search/type（WBI 签名）
 *  - 播放信息：www.bilibili.com/video/{bvid}/ 页面内联的 window.__playinfo__
 *  - 字幕：api.bilibili.com/x/player/wbi/v2
 *
 * 平台标识：哔哩哔哩音乐
 */

const axios = require('axios');
const CryptoJS = require('crypto-js');

const PLATFORM = '哔哩哔哩音乐';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SEARCH_PAGE_SIZE = 42;
const REQUEST_TIMEOUT = 5000;
const MIXIN_KEY_TTL = 60 * 60 * 1000;
const VIDEO_CACHE_TTL = 5 * 60 * 1000;
const VIDEO_CACHE_MAX = 40;

// B 站 WBI 签名密钥置换表
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9,
    42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1,
    60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

// 音质按 DASH 音频流的 id 选择：30216=64K / 30232=132K / 30280=192K。
// bandwidth 每次拉取都会变（实测 65697/82346/181337），不能用来排序。
const AUDIO_QUALITY_PREFERENCE = {
    low: [30216, 30232, 30280],
    standard: [30232, 30280, 30216],
    high: [30280, 30232, 30216],
    super: [30280, 30232, 30216],
};

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无字幕';

let mixinKeyCache = {value: '', time: 0};
const videoCache = new Map();
let buvidCookie = '';

function toHttps(url) {
    if (typeof url !== 'string' || !url) {
        return '';
    }
    if (url.startsWith('//')) {
        return 'https:' + url;
    }
    return url.replace(/^http:\/\//, 'https://');
}

function getHost(url) {
    const matched = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
    return matched ? matched[1].toLowerCase() : '';
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
}

function parseDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.round(value);
    }
    const matched = String(value || '').match(/(\d+):(\d+)/);
    if (!matched) {
        return 0;
    }
    return Number(matched[1]) * 60 + Number(matched[2]);
}

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

// 从 HTML 中截取某个标记之后的第一段完整 JSON
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
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
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

function baseHeaders() {
    return {
        'user-agent': USER_AGENT,
        referer: 'https://www.bilibili.com/',
        origin: 'https://www.bilibili.com',
    };
}

async function request(url, headers) {
    const response = await axios.get(url, {
        headers: {...baseHeaders(), ...(headers || {})},
        timeout: REQUEST_TIMEOUT,
    });
    return response.data;
}

async function requestJson(url, headers) {
    return parseJson(await request(url, headers));
}

// WBI 密钥：nav 接口返回的两张图片文件名按置换表重排
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
    const data = await requestJson('https://api.bilibili.com/x/web-interface/nav');
    const wbi = data?.data?.wbi_img;
    if (!wbi?.img_url || !wbi?.sub_url) {
        throw new Error('无法获取 B 站签名密钥');
    }
    const key = getMixinKeyFrom(wbi.img_url, wbi.sub_url);
    mixinKeyCache = {value: key, time: Date.now()};
    return key;
}

// 完整手工拼串：w_rid 依赖参数顺序，交给 axios 二次编码会破坏签名
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

// 视频页需要设备标识才会内联 __playinfo__
async function getBuvidCookie() {
    if (buvidCookie) {
        return buvidCookie;
    }
    const data = await requestJson('https://api.bilibili.com/x/frontend/finger/spi_v2');
    const b3 = data?.data?.b_3;
    if (!b3) {
        throw new Error('无法获取 B 站设备标识');
    }
    buvidCookie = `buvid3=${b3}; buvid4=${data?.data?.b_4 || ''}`;
    return buvidCookie;
}

async function fetchVideoPage(bvid) {
    const cached = videoCache.get(bvid);
    if (cached && Date.now() - cached.time < VIDEO_CACHE_TTL) {
        return cached.value;
    }
    const cookie = await getBuvidCookie();
    const html = await request(`https://www.bilibili.com/video/${bvid}/`, {
        cookie,
        'accept-language': 'zh-CN,zh;q=0.9',
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

function extractBvid(input) {
    const text = String(input || '').trim();
    if (!text) {
        return null;
    }
    const matched = text.match(/(BV[0-9A-Za-z]{10})/);
    return matched ? matched[1] : null;
}

function toMusicItem(video) {
    if (!video || !video.bvid) {
        return null;
    }
    return {
        id: video.bvid,
        platform: PLATFORM,
        title: stripHtml(video.title) || '未知视频',
        artist: video.author || '',
        album: video.typename || '',
        artwork: toHttps(video.pic),
        duration: parseDuration(video.duration),
        // 扩展字段：后续方法可直接复用
        aid: video.aid,
        arcurl: video.arcurl,
        play: video.play,
    };
}

function pickAudioStream(streams, quality) {
    const preference = AUDIO_QUALITY_PREFERENCE[quality] || AUDIO_QUALITY_PREFERENCE.standard;
    for (const id of preference) {
        const hit = streams.find((item) => Number(item.id) === id);
        if (hit) {
            return hit;
        }
    }
    return streams.slice().sort((a, b) => Number(a.id) - Number(b.id)).pop();
}

// 优先选标准 PC CDN（upos-*.bilivideo.com），它强制校验 Referer
function pickStreamUrl(stream) {
    const candidates = [
        stream.baseUrl,
        stream.base_url,
        ...(stream.backupUrl || []),
        ...(stream.backup_url || []),
    ].filter((url) => typeof url === 'string' && url);
    const standard = candidates.find((url) =>
        getHost(url).split(':')[0].endsWith('bilivideo.com'),
    );
    return toHttps(standard || candidates[0] || '');
}

function toLrcTime(seconds) {
    const ms = Math.max(0, Math.floor(Number(seconds || 0) * 1000));
    const minute = Math.floor(ms / 60000);
    const second = Math.floor((ms % 60000) / 1000);
    const cent = Math.floor((ms % 1000) / 10);
    return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(cent).padStart(2, '0')}]`;
}

module.exports = {
    platform: PLATFORM,
    version: '1.0.0',
    author: 'MusicFree',
    module: '搜索',
    defaultSearchType: 'music',
    // 歌词检索走视频检索，选中后由 getLyric 取回该视频的字幕
    supportedSearchType: ['music', 'lyric'],
    hints: {
        importMusicItem: [
            '支持 B 站视频链接或 BV 号',
            '例如 https://www.bilibili.com/video/BV1FPjy6TEiE/',
        ],
        importMusicSheet: [
            '支持 B 站视频链接或 BV 号，导入为单项列表',
            '例如 https://www.bilibili.com/video/BV1FPjy6TEiE/',
        ],
    },
    userVariables: [
        {
            key: 'cookie',
            name: 'Cookie',
            hint: '可选，登录 B 站后的完整 Cookie，填写后才能获取视频字幕',
        },
    ],

    async search(query, page, type) {
        const keyword = String(query ?? '').trim();
        if (!keyword) {
            return {isEnd: true, data: []};
        }
        const current = Math.max(1, Number(page) || 1);
        const mixinKey = await getMixinKey();
        const queryString = buildSignedQuery(
            {
                search_type: 'video',
                keyword,
                page: current,
                page_size: SEARCH_PAGE_SIZE,
                order: 'totalrank',
                platform: 'pc',
                web_location: 1430654,
            },
            mixinKey,
        );
        const data = await requestJson(
            `https://api.bilibili.com/x/web-interface/wbi/search/type?${queryString}`,
            {referer: 'https://search.bilibili.com/'},
        );
        if (!data) {
            throw new Error('B 站搜索接口返回异常');
        }
        if (data.code !== 0) {
            throw new Error(data.message || 'B 站搜索失败');
        }
        const result = data?.data?.result || [];
        const total = Number(data?.data?.numResults || 0);
        const totalPages = Number(data?.data?.numPages || 0);
        const list = result.map(toMusicItem).filter(Boolean);
        return {
            data: list,
            isEnd:
                list.length === 0 ||
                (totalPages > 0
                    ? current >= totalPages
                    : current * SEARCH_PAGE_SIZE >= total),
        };
    },

    async getMediaSource(musicItem, quality) {
        const bvid = extractBvid(musicItem?.id || musicItem?.bvid);
        if (!bvid) {
            throw new Error('缺少视频 BV 号');
        }
        const {playInfo} = await fetchVideoPage(bvid);
        const dash = playInfo?.data?.dash;
        const streams = Array.isArray(dash?.audio) ? dash.audio.filter((s) => s && s.id) : [];
        if (!streams.length) {
            const durl = playInfo?.data?.durl || [];
            if (durl.length && durl[0]?.url) {
                return {
                    url: toHttps(durl[0].url),
                    headers: {
                        'user-agent': USER_AGENT,
                        referer: 'https://www.bilibili.com/',
                    },
                };
            }
            throw new Error('该视频没有可用的音频流');
        }
        const url = pickStreamUrl(pickAudioStream(streams, quality));
        if (!url) {
            throw new Error('该视频没有可用的音频流');
        }
        return {
            url,
            headers: {
                'user-agent': USER_AGENT,
                referer: 'https://www.bilibili.com/',
            },
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
            const headers = {referer: `https://www.bilibili.com/video/${bvid}/`};
            const cookie = getLoginCookie();
            if (cookie) {
                headers.cookie = cookie;
            }
            const data = await requestJson(
                `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
                headers,
            );
            const subtitles = data?.data?.subtitle?.subtitles || [];
            const target = subtitles.find((item) => item?.subtitle_url) || subtitles[0];
            if (!target?.subtitle_url) {
                throw new Error('该视频没有字幕');
            }
            const subtitle = await requestJson(toHttps(target.subtitle_url), headers);
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

    async importMusicItem(urlLike) {
        const bvid = extractBvid(urlLike);
        if (!bvid) {
            throw new Error('无法识别的 B 站视频链接或 BV 号');
        }
        const {videoData} = await fetchVideoPage(bvid);
        if (!videoData) {
            throw new Error('未找到该视频');
        }
        return toMusicItem({
            bvid: videoData.bvid,
            title: videoData.title,
            author: videoData.owner?.name,
            pic: videoData.pic,
            duration: videoData.duration,
            aid: videoData.aid,
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
