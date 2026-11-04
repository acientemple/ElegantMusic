(() => {
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const md = document.querySelector('.music-detail--container');
    return JSON.stringify({
        hasDetail: !!md,
        detailClasses: md ? md.className : null,
        lyricLike: qa('[class*="lyric"]').map(e => e.className + ' | ' + (e.innerText || '').trim().replace(/\n/g, ' / ').slice(0, 60)).slice(0, 20),
        modals: qa('[class*="modal--"]').map(e => e.className),
    }, null, 2);
})()
