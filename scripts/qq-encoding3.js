const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

(async () => {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    Object.entries({ songmid: '0007LIOE0B9ER7', format: 'json', nobase64: 1, g_tk: 5381 }).forEach(([k, v]) =>
        url.searchParams.set(k, String(v)),
    );
    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' } });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log('前 60 字节 hex:', buf.subarray(0, 60).toString('hex'));

    const encodings = ['utf-8', 'gbk', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'latin1'];
    for (const enc of encodings) {
        try {
            const text = new TextDecoder(enc, { fatal: false }).decode(buf);
            console.log(`\n--- ${enc} ---`);
            console.log(text.slice(0, 150));
        } catch (e) {
            console.log(`--- ${enc} --- 不可用: ${e.message}`);
        }
    }
})();
