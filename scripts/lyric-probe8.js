const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
async function raw(url, headers = {}) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
        const text = await res.text();
        return { status: res.status, text };
    } catch (e) {
        return { status: 'ERR', text: String(e.cause?.code || e.message) };
    }
}
(async () => {
    const hash = '37A8F50A9EC3B267C3CC6BEC633D9C4A';
    const dur = 239386;
    const urls = [
        ['getdata www', `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&timelength=${dur}&album_id=979856&album_audio_id=&df=fd&kdt=1&client=pc`],
        ['getdata mobile', `https://mobileservice.kugou.com/api/v5/getdata?hash=${hash}&timelength=${dur}`],
        ['krcs lyric w/ origin', `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=F8F01C539411B1C9354F4D6E5FE25CB2&duration=${dur}&fmt=lrc&charset=utf8`],
        ['krcs lyric http', `http://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=F8F01C539411B1C9354F4D6E5FE25CB2&duration=${dur}&fmt=lrc&charset=utf8`],
        ['krcs lyric cmd 200', `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=200&hash=${hash}&accesskey=F8F01C539411B1C9354F4D6E5FE25CB2&duration=${dur}&fmt=lrc&charset=utf8`],
        ['krcs lyric clienttype', `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&clienttype=8&hash=${hash}&accesskey=F8F01C539411B1C9354F4D6E5FE25CB2&duration=${dur}&fmt=lrc&charset=utf8`],
    ];
    for (const [label, u] of urls) {
        const r = await raw(u, {
            Referer: 'https://www.kugou.com/',
            Origin: 'https://www.kugou.com',
            Accept: 'application/json, text/plain, */*',
        });
        console.log(`\n>>> ${label}: status=${r.status} len=${r.text.length}`);
        console.log('  ', r.text.slice(0, 300).replace(/\n/g, ' '));
    }
})();
