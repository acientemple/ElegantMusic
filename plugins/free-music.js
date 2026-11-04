/**
 * 免费音乐聚合 —— 一个插件搜索多个免版权音乐站点
 *
 * 数据来源（均为可直连、无需登录的站点）：
 *   - Jamendo            https://www.jamendo.com        独立音乐人社区，CC 授权
 *   - Free Music Archive https://freemusicarchive.org   老牌 CC 音乐库
 *   - ccMixter           https://ccmixter.org           Remix / 采样库
 *   - Freesound          https://freesound.org         音效社区（试听片段）
 *   - Mixkit             https://mixkit.co              Envato 出品的免版权曲库
 *
 * 平台标识：免费音乐聚合
 */

const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

const JAMENDO_LIMIT = 30;
const FMA_PAGE_SIZE = 20;
const FREESOUND_PAGE_SIZE = 15;
const MIXKIT_PAGE_SIZE = 36;

const MAX_PAGE = 10;

const http = axios.create({
    timeout: 7000,
    headers: {
        'user-agent': USER_AGENT,
        accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'accept-language': 'en-US,en;q=0.9',
    },
});

// ---------------------------------------------------------------------------
// Jamendo 的 X-Jam-Call 签名
// 从 jamendo 主打包文件原样移植的 MD4 变体：输入 = 路径 + 随机数，
// 输出 = '$' + 40位十六进制 + '*' + 随机数 + '~'
// ---------------------------------------------------------------------------
function jamCall(url) {
    var t = Math.random(),
        r = /(^https?:\/\/.*?\/)/;
    url = url.replace(r, '/');
    var n = String.fromCharCode;
    return (
        n(36) +
        function(e){var t,r,n,i,o,a,s,l,u,c=function(e,t){return e<<t|e>>>32-t},d=function(e){var t,r="";for(t=7;0<=t;t--)r+=(e>>>4*t&15).toString(16);return r},p=new Array(80),f=1732584193,h=4023233417,m=2562383102,y=271733878,g=3285377520,v=(e=function(e){if(null==e)return"";var t,r,n,i=e+"",o="";t=r=0,n=i.length;for(var a=0;a<n;a++){var s=i.charCodeAt(a),l=null;if(s<128)r++;else if(127<s&&s<2048)l=String.fromCharCode(s>>6|192,63&s|128);else if(55296!=(63488&s))l=String.fromCharCode(s>>12|224,s>>6&63|128,63&s|128);else{if(55296!=(64512&s))throw new RangeError("Unmatched trail surrogate at "+a);var u=i.charCodeAt(++a);if(56320!=(64512&u))throw new RangeError("Unmatched lead surrogate at "+(a-1));s=((1023&s)<<10)+(1023&u)+65536,l=String.fromCharCode(s>>18|240,s>>12&63|128,s>>6&63|128,63&s|128)}null!==l&&(t<r&&(o+=i.slice(t,r)),o+=l,t=r=a+1)}return t<r&&(o+=i.slice(t,n)),o}(e)).length,_=[];for(r=0;r<v-3;r+=4)n=e.charCodeAt(r)<<24|e.charCodeAt(r+1)<<16|e.charCodeAt(r+2)<<8|e.charCodeAt(r+3),_.push(n);switch(v%4){case 0:r=2147483648;break;case 1:r=e.charCodeAt(v-1)<<24|8388608;break;case 2:r=e.charCodeAt(v-2)<<24|e.charCodeAt(v-1)<<16|32768;break;case 3:r=e.charCodeAt(v-3)<<24|e.charCodeAt(v-2)<<16|e.charCodeAt(v-1)<<8|128}for(_.push(r);_.length%16!=14;)_.push(0);for(_.push(v>>>29),_.push(v<<3&4294967295),t=0;t<_.length;t+=16){for(r=0;r<16;r++)p[r]=_[t+r];for(r=16;r<=79;r++)p[r]=c(p[r-3]^p[r-8]^p[r-14]^p[r-16],1);for(i=f,o=h,a=m,s=y,l=g,r=0;r<=19;r++)u=c(i,5)+(o&a|~o&s)+l+p[r]+1518500249&4294967295,l=s,s=a,a=c(o,30),o=i,i=u;for(r=20;r<=39;r++)u=c(i,5)+(o^a^s)+l+p[r]+1859775393&4294967295,l=s,s=a,a=c(o,30),o=i,i=u;for(r=40;r<=59;r++)u=c(i,5)+(o&a|o&s|a&s)+l+p[r]+2400959708&4294967295,l=s,s=a,a=c(o,30),o=i,i=u;for(r=60;r<=79;r++)u=c(i,5)+(o^a^s)+l+p[r]+3395469782&4294967295,l=s,s=a,a=c(o,30),o=i,i=u;f=f+i&4294967295,h=h+o&4294967295,m=m+a&4294967295,y=y+s&4294967295,g=g+l&4294967295}return(u=d(f)+d(h)+d(m)+d(y)+d(g)).toLowerCase()}(url + t) +
            '' +
            n(42) +
            t +
            n(126)
    );
}

const JAMENDO_HEADERS = {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'x-requested-with': 'XMLHttpRequest',
    'x-jam-version': (288174867).toString(36),
    referer: 'https://www.jamendo.com/search',
};

function toText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

// 某些站点（如 FMA）的播放地址是 302 跳转，浏览器跨源跟随重定向会拖慢起播，
// 预先解析出最终直链交给播放器
const finalUrlCache = new Map();

async function resolveFinalUrl(url, headers) {
    if (finalUrlCache.has(url)) return finalUrlCache.get(url);

    let final = url;
    try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers });
        if (res.url) final = res.url;
    } catch (e) {
        try {
            const res = await fetch(url, { redirect: 'follow', headers });
            if (res.url) final = res.url;
            if (res.body && typeof res.body.cancel === 'function') await res.body.cancel();
        } catch (e2) {
            final = url;
        }
    }

    finalUrlCache.set(url, final);
    return final;
}

function parseJson(data) {
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }
    return data;
}

function durationToSeconds(text) {
    const parts = toText(text).split(':').map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return 0;
    return parts.reduce((acc, cur) => acc * 60 + cur, 0);
}

// ---------------------------------------------------------------------------
// 各站点搜索实现
// ---------------------------------------------------------------------------

async function searchJamendo(query, page) {
    const offset = (page - 1) * JAMENDO_LIMIT;
    const url =
        'https://www.jamendo.com/api/search?query=' +
        encodeURIComponent(query) +
        '&type=track&limit=' +
        JAMENDO_LIMIT +
        '&offset=' +
        offset +
        '&identities=www';

    // 签名每次重新生成，避免长时间运行后失效
    const res = await http.get(url, {
        headers: { ...JAMENDO_HEADERS, 'x-jam-call': jamCall('/api/search') },
    });
    const parsed = parseJson(res.data);
    const list = Array.isArray(parsed) ? parsed : parsed?.results || [];

    const data = list
        .filter((t) => t && (t.stream?.mp3 || t.stream?.ogg))
        .map((t) => ({
            id: 'jamendo:' + t.id,
            src: 'jamendo',
            rawId: String(t.id),
            title: toText(t.name),
            artist: toText(t.artist?.name),
            album: toText(t.album?.name),
            artwork:
                t.cover?.big?.size600 ||
                t.cover?.big?.size400 ||
                t.cover?.small?.size300 ||
                '',
            duration: Number(t.duration) || 0,
            url: t.stream.mp3 || t.stream.ogg,
        }));

    return { data, isEnd: list.length < JAMENDO_LIMIT };
}

async function searchFma(query, page) {
    const url =
        'https://freemusicarchive.org/search/?q=' +
        encodeURIComponent(query) +
        '&page=' +
        page;

    const res = await http.get(url);
    const $ = cheerio.load(res.data);
    const data = [];

    $('[data-track-info]').each((i, el) => {
        const raw = $(el).attr('data-track-info');
        let info;
        try {
            info = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!info?.id || !info?.playbackUrl) return;
        const node = $(el);
        const durationText = node.text().match(/\b\d{1,2}:\d{2}\b/);
        data.push({
            id: 'fma:' + info.id,
            src: 'fma',
            rawId: String(info.id),
            title: toText(info.title),
            artist: toText(info.artistName),
            album: toText(node.find('.ptxt-album a').first().text()),
            artwork: '',
            duration: durationText ? durationToSeconds(durationText[0]) : 0,
            url: info.playbackUrl,
            pageUrl: toText(info.url),
        });
    });

    return { data, isEnd: data.length < FMA_PAGE_SIZE };
}

async function searchCcmixter(query, page) {
    // ccMixter 搜索无分页，一次固定返回 10 条上传曲目
    if (page > 1) return { data: [], isEnd: true };

    const url =
        'https://ccmixter.org/search?search_text=' +
        encodeURIComponent(query) +
        '&search_type=any&search_in=all&search=classname&form_submit=Search';

    const res = await http.get(url);
    const $ = cheerio.load(res.data);
    const data = [];

    $('div.search_results_link').each((i, el) => {
        const link = $(el).find('a.cc_file_link').first();
        const href = toText(link.attr('href'));
        if (!href) return;
        const rawId = href.split('/').filter(Boolean).pop();
        if (!rawId) return;
        data.push({
            id: 'ccmixter:' + rawId,
            src: 'ccmixter',
            rawId: String(rawId),
            title: toText(link.text()),
            artist: toText($(el).find('a.cc_user_link').first().text()),
            album: '',
            artwork: '',
            duration: 0,
            url: '',
            pageUrl: href,
        });
    });

    return { data, isEnd: true };
}

async function searchFreesound(query, page) {
    const url =
        'https://freesound.org/search/?q=' +
        encodeURIComponent(query) +
        '&page=' +
        page;

    const res = await http.get(url);
    const $ = cheerio.load(res.data);
    const data = [];

    $('.bw-player').each((i, el) => {
        const node = $(el);
        const mp3 = toText(node.attr('data-mp3'));
        const rawId = toText(node.attr('data-sound-id'));
        if (!rawId || !mp3) return;
        data.push({
            id: 'freesound:' + rawId,
            src: 'freesound',
            rawId: String(rawId),
            title: toText(node.attr('data-title')),
            artist: toText(node.attr('data-username')),
            album: '',
            artwork: toText(node.attr('data-spectrum') || node.attr('data-waveform') || ''),
            duration: Math.round(Number(node.attr('data-duration')) || 0),
            url: mp3,
        });
    });

    return { data, isEnd: data.length < FREESOUND_PAGE_SIZE };
}

async function searchMixkit(query, page) {
    const slug = toText(query)
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug) return { data: [], isEnd: true };

    const url =
        'https://mixkit.co/free-stock-music/' +
        slug +
        '/' +
        (page > 1 ? '?page=' + page : '');

    const res = await http.get(url);
    const $ = cheerio.load(res.data);
    const data = [];

    $('.item-grid-card').each((i, el) => {
        const card = $(el);
        const player = card.find('[data-audio-player-preview-url-value]').first();
        const audio = toText(player.attr('data-audio-player-preview-url-value'));
        const rawId = toText(player.attr('data-audio-player-item-id-value'));
        if (!audio || !rawId) return;
        data.push({
            id: 'mixkit:' + rawId,
            src: 'mixkit',
            rawId: String(rawId),
            title: toText(card.find('.item-grid-card__title').text()),
            artist: toText(
                card
                    .find('.item-grid-music-preview__author')
                    .text()
                    .replace(/^\s*by\s+/i, ''),
            ),
            album: '',
            artwork: '',
            duration: 0,
            url: audio,
        });
    });

    return { data, isEnd: data.length < MIXKIT_PAGE_SIZE };
}

const SEARCHERS = [
    ['jamendo', searchJamendo],
    ['fma', searchFma],
    ['ccmixter', searchCcmixter],
    ['freesound', searchFreesound],
    ['mixkit', searchMixkit],
];

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

module.exports = {
    platform: '免费音乐聚合',
    version: '1.0.0',
    author: 'MusicFree Desktop',
    description:
        '聚合 Jamendo / Free Music Archive / ccMixter / Freesound / Mixkit 五个免版权音乐站，可直接播放',
    supportedSearchType: ['music'],
    cacheControl: 'no-cache',

    async search(query, page, type) {
        if (type !== 'music') return { isEnd: true, data: [] };
        if (!toText(query)) return { isEnd: true, data: [] };

        const currentPage = Math.max(1, Number(page) || 1);

        const settled = await Promise.allSettled(
            SEARCHERS.map(([, fn]) => fn(query, currentPage)),
        );

        const data = [];
        let isEnd = currentPage >= MAX_PAGE;

        settled.forEach((res, index) => {
            const name = SEARCHERS[index][0];
            if (res.status !== 'fulfilled') {
                console.error('[免费音乐聚合] ' + name + ' 搜索失败: ' + res.reason?.message);
                return;
            }
            res.value.data.forEach((item) => {
                data.push({ ...item, src: name });
            });
            if (!res.value.isEnd) isEnd = false;
        });

        return { isEnd, data };
    },

    async getMediaSource(musicItem, quality) {
        const item = musicItem || {};
        const headers = { 'user-agent': USER_AGENT };

        switch (item.src) {
            case 'jamendo': {
                if (!item.url) throw new Error('缺少播放链接');
                return { url: item.url, headers };
            }
            case 'fma': {
                if (!item.url) throw new Error('缺少播放链接');
                return { url: await resolveFinalUrl(item.url, headers), headers };
            }
            case 'freesound': {
                if (!item.url) throw new Error('缺少播放链接');
                return { url: item.url, headers };
            }
            case 'mixkit': {
                if (!item.url) throw new Error('缺少播放链接');
                return { url: item.url, headers: { ...headers, referer: 'https://mixkit.co/' } };
            }
            case 'ccmixter': {
                const rawId = String(
                    item.rawId || String(item.id || '').replace(/^ccmixter:/, ''),
                );
                if (!rawId) throw new Error('缺少 ccmixter 文件 id');
                const ccHeaders = { ...headers, referer: 'https://ccmixter.org/' };
                const url =
                    'https://ccmixter.org/api/query/api?ids=' +
                    encodeURIComponent(rawId) +
                    '&f=json&dataview=links_dl';
                try {
                    const res = await http.get(url, { headers: ccHeaders });
                    const parsed = parseJson(res.data);
                    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
                    const files = list[0]?.files || [];
                    const file = files.find((f) => f?.file_nicname === 'mp3') || files[0];
                    if (!file?.download_url) throw new Error('API 未返回 download_url');
                    return { url: file.download_url, headers: ccHeaders };
                } catch (e) {
                    console.error(
                        '[免费音乐聚合] ccmixter 播放链接获取失败 rawId=' +
                            rawId +
                            ' keys=' +
                            Object.keys(item || {}).join(',') +
                            ' : ' +
                            (e && e.message),
                    );
                    throw e;
                }
            }
            default:
                throw new Error('未知的音乐来源：' + item.src);
        }
    },

    async getMusicInfo(musicItem) {
        const item = musicItem || {};
        if (item.src !== 'ccmixter' || !item.rawId) return {};
        try {
            const url =
                'https://ccmixter.org/api/query/api?ids=' +
                encodeURIComponent(item.rawId) +
                '&f=json&dataview=links_dl';
            const res = await http.get(url, {
                headers: { 'user-agent': USER_AGENT, referer: 'https://ccmixter.org/' },
            });
            const parsed = parseJson(res.data);
            const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
            const files = list[0]?.files || [];
            const file = files.find((f) => f?.file_nicname === 'mp3') || files[0];
            const duration = durationToSeconds(file?.file_format_info?.ps);
            return { duration: duration || item.duration };
        } catch (e) {
            return {};
        }
    },
};
