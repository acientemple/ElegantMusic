const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
async function jget(url, params, headers = {}) {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text), text }; } catch { return { status: res.status, json: null, text }; }
}
(async () => {
    for (const u of [
        'https://lrclib.net/api/get/36075439',
        'https://lrclib.net/api/get?track_name=青花瓷&artist_name=周杰伦',
    ]) {
        const r = await jget(u, {}, { referer: 'https://lrclib.net/' });
        console.log(u.slice(0, 70), '->', r.status, r.json ? Object.keys(r.json).join(',') : r.text.slice(0, 80));
        if (r.json) {
            console.log('   ', r.json.trackName, '/', r.json.artistName, 'synced', (r.json.syncedLyrics||'').split('\n').length, 'plain', (r.json.plainLyrics||'').split('\n').length);
        }
    }
})();
