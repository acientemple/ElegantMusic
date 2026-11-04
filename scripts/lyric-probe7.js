const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
async function raw(url, headers = {}) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    return { status: res.status, text };
}
(async () => {
    const hash = '37A8F50A9EC3B267C3CC6BEC633D9C4A';
    const ak = 'F8F01C539411B1C9354F4D6E5FE25CB2';
    const dur = 239386;
    const urls = [
        `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=${ak}&duration=${dur}&fmt=lrc&charset=utf8`,
        `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&accesskey=${ak}&duration=${dur}&fmt=krc&charset=utf8`,
        `https://krcs.kugou.com/lyric?ver=1&client=pc&cmd=100&hash=${hash}&duration=${dur}&fmt=lrc&charset=utf8`,
        `http://api.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&timelength=${dur}&album_id=979856&album_audio_id=&df=fd&kdt=1&client=pc`,
        `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&timelength=${dur}&album_id=979856&album_audio_id=&df=fd&kdt=1&client=pc`,
        `https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=%E9%9D%92%E8%8A%B1%E7%93%B7&page=1&pagesize=3`,
    ];
    for (const u of urls) {
        const r = await raw(u, { Referer: 'https://www.kugou.com/' });
        console.log('\n>>>', u.slice(0, 110));
        console.log('  status', r.status, 'len', r.text.length);
        console.log('  ', r.text.slice(0, 400).replace(/\n/g, ' '));
    }
})();
