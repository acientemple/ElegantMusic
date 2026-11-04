const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

(async () => {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    const params = { songmid: '002qU5aY3Qu24y', format: 'json', nobase64: 1, g_tk: 5381 };
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' } });
    console.log('content-type:', res.headers.get('content-type'));
    const buf = Buffer.from(await res.arrayBuffer());
    console.log('bytes:', buf.length);

    console.log('\n--- utf-8 ---');
    console.log(buf.toString('utf8').slice(0, 300));
    try {
        console.log('\n--- gbk ---');
        console.log(new TextDecoder('gbk').decode(buf).slice(0, 300));
    } catch (e) {
        console.log('gbk decoder unavailable:', e.message);
    }

    console.log('\n--- 带 charset=utf-8 再试 ---');
    const url2 = new URL(url.toString());
    url2.searchParams.set('charset', 'utf-8');
    const res2 = await fetch(url2.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' } });
    const buf2 = Buffer.from(await res2.arrayBuffer());
    console.log(buf2.toString('utf8').slice(0, 260));

    console.log('\n--- 换一首英文歌看是否也乱码 ---');
    const url3 = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    Object.entries({ songmid: '0041gObR2QG98x', format: 'json', nobase64: 1, g_tk: 5381 }).forEach(([k, v]) => url3.searchParams.set(k, String(v)));
    const res3 = await fetch(url3.toString(), { headers: { 'User-Agent': UA, referer: 'https://y.qq.com/' } });
    const buf3 = Buffer.from(await res3.arrayBuffer());
    console.log('utf-8:', buf3.toString('utf8').slice(0, 200));
})();
