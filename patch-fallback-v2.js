const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/Lenovo/AppData/Roaming/MusicFree/musicfree-plugins';
const files = ['music-chart.js', 'hot-sheets.js', 'full-track.js'];

const PATCHES = [
    {
        from: `    const results = [];
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
    return results;`,
        to: `    const results = [];
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
    return results;`,
    },
    {
        from: `        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        if (rawLrc) {
            return [{ rawLrc, translation: '' }];
        }`,
        to: `        const rawLrc = (data && (data.syncedLyrics || data.plainLyrics)) || '';
        if (rawLrc) {
            // 按歌名与歌手精确取回的，匹配度按满计算
            return [{ rawLrc, translation: '', match: 7 }];
        }`,
    },
    {
        from: `/** 时间轴行数越多越好，有翻译再加一笔 */
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
}`,
        to: `/** 歌词里出现大量非常用字符，说明这份歌词的编码不对 */
function garbledRatio(lrc) {
    const chars = String(lrc || '').replace(/\\s/g, '');
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
        .split(/\\r?\\n/)
        .filter((line) => !/^\\s*\\[(ti|ar|al|by)\\s*:/i.test(line))
        .join('\\n');
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
}`,
    },
];

files.forEach((name) => {
    const file = path.join(dir, name);
    let text = fs.readFileSync(file, 'utf8');
    if (text.includes('garbledRatio')) {
        console.log('skip (already v2) ' + name);
        return;
    }
    PATCHES.forEach((patch, index) => {
        if (!text.includes(patch.from)) {
            throw new Error(`patch #${index} not found in ${name}`);
        }
        text = text.replace(patch.from, patch.to);
    });
    fs.writeFileSync(file, text);
    console.log('patched ' + name);
});
