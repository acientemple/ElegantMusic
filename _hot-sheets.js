/**
 * 热门歌单 —— 网易云音乐聚合插件
 *
 * 覆盖 MusicFree「热门歌单」页：标签分组 / 歌单列表 / 歌单详情 / 在线播放 / 歌词 / 搜索 / 歌单导入
 * 平台标识：热门歌单
 */

const axios = require('axios');

const PLATFORM = '热门歌单';
const API_HOST = 'https://music.163.com';

const SHEET_PAGE_SIZE = 50;
const TRACK_PAGE_SIZE = 50;
const SEARCH_PAGE_SIZE = 30;

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 网易云 Web 接口在缺少客户端标识时只吐出 10 首歌，
// 带上 os / appver 才会返回完整歌单。
const CLIENT_COOKIE = { os: 'pc', appver: '2.9.7' };

// 主进程在 rawLrc 与 translation 同时为空时会返回 null，
// 渲染层随后读取 null.rawLrc 抛错，故用占位歌词兜底。
const NO_LYRIC_LRC = '[00:00.00]暂无歌词';

const QUALITY_BITRATE = {
    low: 64000,
    standard: 128000,
    high: 320000,
    super: 999000,
};

const QUALITY_ORDER = ['low', 'standard', 'high', 'super'];

const SEARCH_TYPE = {
    music: 1,
    album: 10,
    artist: 100,
    sheet: 1000,
    // 网易云没有开放歌词检索接口，退化为歌曲检索，
    // 选中后由 getLyric 按歌曲 id 取回歌词
    lyric: 1,
};

// 歌单分类，分组与分类名取自 music.163.com/discover/playlist 的官方分类栏，
// 全部为实测有效、且各自返回独立结果的分类名
const TAG_GROUPS = [
    {
        title: '语种',
        data: ['华语', '欧美', '日韩', '日语', '韩语', '粤语'],
    },
    {
        title: '风格',
        data: [
            '流行', '摇滚', '民谣', '电子', '轻音乐', '古典', '乡村',
            '说唱', '爵士', '金属', '朋克', '拉丁',
        ],
    },
    {
        title: '场景',
        data: [
            '夜晚', '学习', '工作', '午休', '下午茶', '地铁',
            '驾车', '散步', '旅行', '酒吧', '运动',
        ],
    },
    {
        title: '情感',
        data: ['伤感', '快乐', '孤独', '思念', '治愈', '安静'],
    },
    {
        title: '主题',
        data: ['经典', '影视原声', '游戏', 'ACG', '儿童'],
    },
];

// 网易云没有「日韩」这个分类，接口只认单个官方分类名，
// 多值（如 cat=日语,韩语）会被当成无效分类返回无关结果，
// 因此这里合并「日语」「韩语」两个官方分类自行实现
const COMPOSITE_TAGS = {
    日韩: ['日语', '韩语'],
};

const PINNED_TAGS = ['华语', '流行', '摇滚', '民谣', '电子'];

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

// 合并分类：接口不支持多分类查询，只能分别取各官方分类再交错合并
async function fetchCompositeSheets(cats, page) {
    const current = Math.max(1, Number(page) || 1);
    const perCatLimit = Math.ceil(SHEET_PAGE_SIZE / cats.length);
    const offset = (current - 1) * perCatLimit;
    const results = await Promise.all(
        cats.map((cat) =>
            request('/api/playlist/list', {
                order: 'hot',
                limit: perCatLimit,
                offset,
                cat,
            }),
        ),
    );
    const lists = results.map((result) => result?.playlists || []);
    const merged = [];
    const seen = new Set();
    const longest = Math.max(...lists.map((list) => list.length));
    for (let i = 0; i < longest; i++) {
        for (const list of lists) {
            const playlist = list[i];
            if (!playlist?.id) {
                continue;
            }
            const id = String(playlist.id);
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            merged.push(playlist);
        }
    }
    const isEnd = results.every((result, index) => {
        const total = Number(result?.total) || 0;
        return lists[index].length === 0 || offset + lists[index].length >= total;
    });
    return {
        data: merged.map(toSheetItem).filter(Boolean),
        isEnd,
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
    version: '1.0.0',
    author: 'MusicFree',
    description: '网易云音乐热门歌单：标签分类浏览、完整歌单曲目、在线播放与歌词',
    cacheControl: 'no-cache',
    // lyric 走歌曲检索（SEARCH_TYPE.lyric = 1），选中后由 getLyric 取回歌词
    supportedSearchType: ['music', 'album', 'artist', 'sheet', 'lyric'],
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

    async getRecommendSheetTags() {
        return {
            pinned: PINNED_TAGS.map((title) => ({ id: title, title })),
            data: TAG_GROUPS.map((group) => ({
                title: group.title,
                data: group.data.map((title) => ({ id: title, title })),
            })),
        };
    },

    async getRecommendSheetsByTag(tag, page) {
        const current = Math.max(1, Number(page) || 1);
        const cat = String(tag?.id || '').trim();
        const composite = COMPOSITE_TAGS[cat];
        if (composite) {
            return fetchCompositeSheets(composite, current);
        }
        const offset = (current - 1) * SHEET_PAGE_SIZE;
        const params = {
            order: 'hot',
            limit: SHEET_PAGE_SIZE,
            offset,
        };
        if (cat) {
            params.cat = cat;
        }
        const data = await request('/api/playlist/list', params);
        const playlists = data?.playlists || [];
        const total = Number(data?.total) || 0;
        return {
            data: playlists.map(toSheetItem).filter(Boolean),
            isEnd: playlists.length === 0 || offset + playlists.length >= total,
        };
    },

    async getMusicSheetInfo(sheetItem, page) {
        const id = sheetItem?.id;
        if (!id) {
            return { sheetItem: sheetItem || {}, musicList: [], isEnd: true };
        }
        const current = Math.max(1, Number(page) || 1);
        const playlist = await fetchPlaylistDetail(id);
        const tracks = playlist.tracks || [];
        const start = (current - 1) * TRACK_PAGE_SIZE;
        return {
            sheetItem: {
                ...sheetItem,
                ...(toSheetItem(playlist) || {}),
                trackCount: tracks.length,
            },
            musicList: toMusicList(tracks.slice(start, start + TRACK_PAGE_SIZE)),
            isEnd: start + TRACK_PAGE_SIZE >= tracks.length,
        };
    },

    async getAlbumInfo(albumItem, page) {
        const id = albumItem?.id;
        if (!id) {
            return { albumItem: albumItem || {}, musicList: [], isEnd: true };
        }
        const data = await request('/api/album/' + encodeURIComponent(String(id)));
        const album = data?.album || {};
        const tracks = album.songs || [];
        const current = Math.max(1, Number(page) || 1);
        const start = (current - 1) * TRACK_PAGE_SIZE;
        return {
            albumItem: { ...albumItem, ...(toAlbumItem(album) || {}) },
            musicList: toMusicList(tracks.slice(start, start + TRACK_PAGE_SIZE)),
            isEnd: start + TRACK_PAGE_SIZE >= tracks.length,
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

    async importMusicSheet(urlLike) {
        const resource = extractResourceId(urlLike);
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
        if (!rawLrc && !translation) {
            return { rawLrc: NO_LYRIC_LRC, translation: '' };
        }
        return { rawLrc, translation };
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

        let items = [];
        if (type === 'album') {
            items = raw.map(toAlbumItem).filter(Boolean);
        } else if (type === 'artist') {
            items = raw.map(toArtistItem).filter(Boolean);
        } else if (type === 'sheet') {
            items = raw.map(toSheetItem).filter(Boolean);
        } else {
            items = raw.map(toMusicItem).filter(Boolean);
        }

        return {
            data: items,
            isEnd: items.length === 0 || offset + items.length >= total,
        };
    },
};
