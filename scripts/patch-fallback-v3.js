const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../plugins');
const files = ['music-chart.js', 'hot-sheets.js', 'full-track.js'];

const PATCHES = [
    {
        from: `async function fallbackGet(url, params, headers) {
    const response = await axios.get(url, {
        params: params || {},
        headers: { 'user-agent': USER_AGENT, ...(headers || {}) },
        timeout: FALLBACK_TIMEOUT,
    });
    return response.data;
}`,
        to: `async function fallbackGet(url, params, headers, timeout) {
    const response = await axios.get(url, {
        params: params || {},
        headers: { 'user-agent': USER_AGENT, ...(headers || {}) },
        timeout: timeout || FALLBACK_TIMEOUT,
    });
    return response.data;
}`,
    },
    {
        from: `        const data = await fallbackGet(
            'https://lrclib.net/api/get',
            { track_name: title, artist_name: artist || '' },
            { referer: 'https://lrclib.net/' },
        );`,
        to: `        const data = await fallbackGet(
            'https://lrclib.net/api/get',
            { track_name: title, artist_name: artist || '' },
            { referer: 'https://lrclib.net/' },
            LRCLIB_TIMEOUT,
        );`,
    },
    {
        from: `const FALLBACK_TIMEOUT = 6000;`,
        to: `const FALLBACK_TIMEOUT = 6000;
/** LRCLIB 常年不稳定，给它更短的超时，别拖累整体取词速度 */
const LRCLIB_TIMEOUT = 3000;`,
    },
    {
        from: `/** 网易云没有歌词时的跨源兜底 */
async function fetchFallbackLyric(title, artist) {
    if (!title) {
        return null;
    }
    const results = await Promise.all([
        fetchQQLyricByName(title, artist).catch(() => []),
        fetchLrclibLyricByName(title, artist).catch(() => []),
    ]);
    return pickBestLyric(results[0].concat(results[1]));
}`,
        to: `/** 网易云没有歌词时的跨源兜底：先用 QQ，QQ 没有再用 LRCLIB */
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
}`,
    },
];

files.forEach((name) => {
    const file = path.join(dir, name);
    let text = fs.readFileSync(file, 'utf8');
    if (text.includes('LRCLIB_TIMEOUT')) {
        console.log('skip (already v3) ' + name);
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
