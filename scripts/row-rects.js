(() => {
    const trs = Array.from(document.querySelectorAll('.music-list-container tbody tr'));
    return JSON.stringify({
        innerH: innerHeight,
        rows: trs.slice(0, 8).map((tr) => {
            const td = tr.querySelectorAll('td');
            const r = td[2]?.getBoundingClientRect();
            const x = r ? r.x + r.width / 2 : 0;
            const y = r ? r.y + r.height / 2 : 0;
            const hit = r ? document.elementFromPoint(x, y) : null;
            return {
                title: (td[2]?.innerText || '').trim().slice(0, 26),
                rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
                hitTag: hit ? hit.tagName + '.' + (hit.className || '').toString().slice(0, 40) : null,
                inCell: hit && td[2] ? td[2].contains(hit) : false,
            };
        }),
    }, null, 2);
})()
