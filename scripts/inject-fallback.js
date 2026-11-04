const fs = require('fs');
const path = require('path');

const BLOCK = String.raw`
/* ---------------------------- 跨源歌词兜底 ---------------------------- */

// 网易云没有收录这首歌、或这首歌没有歌词时，改从 QQ 音乐与 LRCLIB 取词
const FALLBACK_TIMEOUT = 6000;

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

async function fallbackGet(url, params, headers) {
    const response = await axios.get(url, {
        params: params || {},
        headers: { 'user-agent': USER_AGENT, ...(headers || {}) },
        timeout: FALLBACK_TIMEOUT,
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
    for (const item of ranked.slice(0, 3)) {
        // 歌名与歌手都对不上的候选直接跳过
        if (item.score < 3) {
            break;
        }
        try {
            const lyric = await fallbackGet(
                'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
                { songmid: item.songmid, format: 'json', nobase64: 1, g_tk: 5381 },
                { referer: 'https://y.qq.com/' },
            );
            if (Number(lyric && lyric.code) === 0 && lyric && lyric.lyric) {
                results.push({ rawLrc: lyric.lyric, translation: lyric.trans || '' });
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
        );
        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        if (rawLrc) {
            return [{ rawLrc, translation: '' }];
        }
    } catch (e) {
        // 取不到就当没有
    }
    return [];
}

/** 时间轴行数越多越好，有翻译再加一笔 */
function pickBestLyric(list) {
    let best = null;
    let bestScore = -1;
    (list || []).forEach((item) => {
        if (!item || !isUsableLyric(item.rawLrc)) {
            return;
        }
        let score = Math.min(countLyricTimedLines(item.rawLrc), 60);
        if (item.translation && item.translation.trim()) {
            score += 25;
        }
        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    });
    return best;
}

/** 网易云没有歌词时的跨源兜底 */
async function fetchFallbackLyric(title, artist) {
    if (!title) {
        return null;
    }
    const results = await Promise.all([
        fetchQQLyricByName(title, artist).catch(() => []),
        fetchLrclibLyricByName(title, artist).catch(() => []),
    ]);
    return pickBestLyric(results[0].concat(results[1]));
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

`;

const OLD_GET_LYRIC = `    async getLyric(musicItem) {
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
    },`;

const NEW_GET_LYRIC = `    async getLyric(musicItem) {
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
    },`;

const ANCHOR = 'function toHttps(url) {';

const dir = path.resolve(__dirname, '../plugins');
const files = ['music-chart.js', 'hot-sheets.js', 'full-track.js'];

files.forEach((name) => {
    const file = path.join(dir, name);
    let text = fs.readFileSync(file, 'utf8');
    const crlf = text.includes('\r\n');
    let block = BLOCK;
    let target = NEW_GET_LYRIC;
    if (crlf) {
        block = block.replace(/\n/g, '\r\n');
        target = target.replace(/\n/g, '\r\n');
    }
    if (text.includes('跨源歌词兜底')) {
        console.log('skip (already patched) ' + name);
        return;
    }
    if (!text.includes(ANCHOR)) {
        throw new Error('anchor not found in ' + name);
    }
    if (!text.includes(OLD_GET_LYRIC)) {
        throw new Error('getLyric block not found in ' + name);
    }
    text = text.replace(ANCHOR, block + ANCHOR);
    text = text.replace(OLD_GET_LYRIC, target);
    fs.writeFileSync(file, text);
    console.log('patched ' + name + (crlf ? ' (crlf)' : ' (lf)'));
});
