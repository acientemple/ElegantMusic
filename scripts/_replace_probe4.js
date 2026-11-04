// 列出 body 下的主要容器 class，找播放条/队列面板
(() => {
    const out = [];
    const walk = (el, depth) => {
        if (depth > 4) return;
        for (const child of el.children) {
            const cls = String(child.className || "");
            const text = (child.innerText || "").replace(/\s+/g, " ").trim();
            out.push({
                d: depth,
                cls: cls.slice(0, 70),
                tag: child.tagName,
                text: text.slice(0, 60),
            });
            walk(child, depth + 1);
        }
    };
    walk(document.body, 0);
    return JSON.stringify(out.slice(0, 120), null, 1);
})();
