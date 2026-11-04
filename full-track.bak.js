/**
 * 完整版搜索 —— 网易云音乐聚合插件
 *
 * 解决的问题：网易云上不少歌曲是 VIP，不登录只能拿到 30 秒左右的试听片段。
 * 本插件做两件事：
 *   1. 搜索时只吐出能整轨播放的歌曲 —— 用接口实际返回的音频字节数反推长度来校验；
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
// 网易云接口一次最多稳妥处理 25 个 id
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
// 实测整轨约 1.00，试听片段约 0.10~0.17，两者区分得很开。
const FULL_LENGTH_RATIO = 0.5;

// 伴奏、改编、加速慢速、儿童/冥想类衍生录音都不算「同一首歌的完整版」。
// 这些噪音版本往往时长也接近原曲，光靠长度筛选会把它们排到前面。
const NOISE_MARKERS = [
    '伴奏',
    '纯音乐',
    '纯钢琴',
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
];

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

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
    return {
        id: String(song.id),
        platform: PLATFORM,
        title: song.name || '未知歌曲',
        artist: pickArtistName(song) || '未知歌手',
        album: album.name || '',
        artwork: toHttps(album.picUrl || album.blurPicUrl || ''),
        duration: Math.round(Number(song.duration || 0) / 1000),
    };
}

function isNoiseVersion(song) {
    const album = song?.al || song?.album || {};
    const text = (
        String(song?.name || '') +
        ' ' +
        String(album.name || '')
    ).toLowerCase();
    return NOISE_MARKERS.some((marker) => text.includes(marker));
}

// 候选与原曲是否出自同一位歌手
function isSameArtist(song, origin) {
    const artist = pickArtistName(song);
    const originArtist = String(origin?.artist || '');
    if (!artist || !originArtist) {
        return false;
    }
    return (
        artist.includes(originArtist) ||
        (artist.length >= 2 && originArtist.includes(artist))
    );
}

async function searchSongs(query, limit, offset = 0) {
    const data = await request('/api/search/get/web', {
        csrf_token: '',
        s: String(query ?? ''),
        type: 1,
        offset,
        limit,
        total: true,
    });
    const result = data?.result || {};
    return {
        songs: result.songs || [],
        total: Number(result.songCount) || 0,
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

// 用实际返回的字节数反推长度：整轨约等于 理论长度，试听片段只有一成左右
function isFullTrack(song, source) {
    if (!source?.url || !source?.size) {
        return false;
    }
    const duration = Number(song.duration || 0) / 1000;
    if (duration <= 0) {
        return false;
    }
    return source.size / (duration * CHECK_BYTES_PER_SEC) >= FULL_LENGTH_RATIO;
}

function scoreCandidate(song, origin) {
    const name = String(song.name || '');
    const originName = String(origin?.title || '');
    let score = 0;
    if (originName) {
        if (name === originName) {
            score += 100;
        } else if (name.includes(originName)) {
            score += 50;
        }
    }
    // 原唱歌手的版本最有用，翻唱往后排
    if (isSameArtist(song, origin)) {
        score += 60;
    }
    const originDuration = Number(origin?.duration || 0);
    if (originDuration > 0) {
        score -= Math.abs(Number(song.duration || 0) / 1000 - originDuration) / 60;
    }
    return score;
}

async function pickFullTrack(songs, origin) {
    const originId = String(origin?.id ?? '');
    const usable = (songs || []).filter(
        (song) =>
            song?.id &&
            String(song.id) !== originId &&
            !isNoiseVersion(song),
    );
    if (!usable.length) {
        return [];
    }
    const sources = await fetchPlaySources(usable.map((song) => song.id));
    const full = usable.filter((song) =>
        isFullTrack(song, sources.get(String(song.id))),
    );
    full.sort((a, b) => scoreCandidate(b, origin) - scoreCandidate(a, origin));
    const originDuration = Number(origin?.duration || 0);
    return full
        .map((song) => {
            const item = toMusicItem(song);
            if (!item) {
                return null;
            }
            item.isOriginArtist = isSameArtist(song, origin);
            item.durationDelta = originDuration
                ? Math.round(Math.abs(Number(song.duration || 0) / 1000 - originDuration))
                : null;
            return item;
        })
        .filter(Boolean);
}

module.exports = {
    platform: PLATFORM,
    version: '1.0.0',
    author: 'MusicFree',
    description:
        '网易云音乐完整版搜索：只返回能整轨播放的歌曲，并可按歌名找出同一首歌的其他完整版本',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
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
        const { songs, total } = await searchSongs(query, SEARCH_PAGE_SIZE, offset);
        const data = await pickFullTrack(songs, null);
        return {
            data,
            isEnd: songs.length === 0 || offset + songs.length >= total,
        };
    },

    async getMusicAlternatives(musicItem) {
        const title = String(musicItem?.title || '').trim();
        const artist = String(musicItem?.artist || '').trim();
        if (!title) {
            throw new Error('缺少歌曲名');
        }
        const first = await searchSongs(title, 50);
        let songs = first.songs;
        let data = await pickFullTrack(songs, musicItem);
        // 只按歌名搜到的完整版太少时，再带上歌手搜一轮
        if (data.length < 3 && artist) {
            const second = await searchSongs(`${title} ${artist}`, 30);
            const seen = new Set(songs.map((song) => String(song.id)));
            for (const song of second.songs) {
                if (!seen.has(String(song.id))) {
                    seen.add(String(song.id));
                    songs.push(song);
                }
            }
            data = await pickFullTrack(songs, musicItem);
        }
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
        // fee=1 表示当前身份只能拿到试听片段
        if (source.fee === 1) {
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
        if (!rawLrc && !translation) {
            return { rawLrc: NO_LYRIC_LRC, translation: '' };
        }
        return { rawLrc, translation };
    },
};
