(() => {
    const c = document.querySelector('.music-detail--container');
    if (!c) return JSON.stringify({ found: false });
    const walk = (el, depth) => {
        if (depth > 4) return [];
        return Array.from(el.children).flatMap((ch) => {
            const cls = (ch.className || '').toString();
            const txt = (ch.innerText || '').trim().replace(/\n/g, ' / ').slice(0, 50);
            return [{ d: depth, tag: ch.tagName, cls: cls.slice(0, 60), txt }, ...walk(ch, depth + 1)];
        });
    };
    return JSON.stringify({ found: true, tree: walk(c, 0).slice(0, 60) }, null, 2);
})()
