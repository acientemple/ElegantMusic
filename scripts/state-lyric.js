(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    return {
        url: location.href,
        hash: location.hash,
        musicDetail: !!q('.music-detail--container'),
        lyricItems: qa('.music-detail--container .lyric-item').map(e => (e.innerText || '').trim()).slice(0, 12),
        bottomBar: qa('.music-bar--container, [class*="music-bar"]').length,
        currentSong: qa('.music-bar--container *').filter(e => e.children.length === 0 && (e.innerText || '').trim()).slice(0, 6).map(e => (e.innerText || '').trim()),
        modals: qa('[class*="modal--"]').map(e => e.className).slice(0, 10),
        tabList: qa('.tab-list-item').map(e => (e.innerText || '').trim()),
    };
})()
