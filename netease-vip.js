const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
async function jget(url, params, headers = {}) {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}
const art = (s) => (s.ar || s.artists || []).map(a => a.name).join('/');
async function top(q, cookie) {
    const d = await jget('https://music.163.com/api/search/get', { s: q, type: 1, limit: 5, offset: 0 },
        { referer: 'https://music.163.com/', origin: 'https://music.163.com', cookie });
    const songs = d?.result?.songs || [];
    return songs.map((s, i) => `${i}. ${s.name} / ${art(s)}${s.fee ? ' [fee=' + s.fee + ']' : ''}`).join(' | ');
}
(async () => {
    console.log('孤勇者 [pc]:', await top('孤勇者', 'os=pc; appver=2.9.7'));
    console.log('起风了 [pc]:', await top('起风了', 'os=pc; appver=2.9.7'));
    console.log('晴天 [android]:', await top('晴天', 'os=android; appver=8.9.20'));
    console.log('晴天 [无 cookie]:', await top('晴天', ''));
    console.log('晴天 [iphone]:', await top('晴天', 'os=ios; appver=8.9.20'));
})();
