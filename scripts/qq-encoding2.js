const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchRaw(songmid, extra = {}) {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    Object.entries({ songmid, format: 'json', nobase64: 1, g_tk: 5381, ...extra }).forEach(([k, v]) =>
        url.searchParams.set(k, String(v)),
    );
    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' } });
    return Buffer.from(await res.arrayBuffer());
}

function head(buf, decoder) {
    const text = decoder(buf);
    try {
        const j = JSON.parse(text);
        return (j.lyric || '').split('\n').slice(0, 3).join(' / ');
    } catch {
        return text.slice(0, 120);
    }
}

(async () => {
    const mids = [
        ['原版 青花瓷', '002qU5aY3Qu24y'],
        ['DJ版 青花瓷', '0007LIOE0B9ER7'],
        ['原版 Shape of You', '0041gObR2QG98x'],
        ['夜曲', '001zMQr71F1Qo8'],
    ];
    for (const [label, mid] of mids) {
        const buf = await fetchRaw(mid);
        const bufCs = await fetchRaw(mid, { charset: 'utf-8' });
        console.log(`\n=== ${label} (${mid}) bytes=${buf.length}`);
        console.log('  utf-8 :', head(buf, (b) => b.toString('utf8')));
        console.log('  +charset:', head(bufCs, (b) => b.toString('utf8')));
        console.log('  gbk   :', head(buf, (b) => new TextDecoder('gbk').decode(b)));
    }
})();
