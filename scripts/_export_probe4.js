// 深入探测 webpackHotUpdate 全局对象的结构
(async () => {
    const g = window["webpackHotUpdatemusicfree_desktop"];
    const out = {
        type: typeof g,
        keys: Object.keys(g),
    };
    for (const k of Object.keys(g)) {
        const v = g[k];
        out["k_" + k] = {
            isArray: Array.isArray(v),
            len: Array.isArray(v) ? v.length : null,
            types: Array.isArray(v)
                ? v.map((x) => (typeof x === "function" ? "fn" : typeof x))
                : null,
        };
        const rt = Array.isArray(v) ? v[2] : null;
        out["k_" + k + "_runtime"] = {
            type: typeof rt,
            keys: rt && typeof rt === "object" ? Object.keys(rt).slice(0, 40) : null,
            hasC: !!(rt && rt.c),
            cSize: rt && rt.c ? Object.keys(rt.c).length : null,
        };
    }
    return JSON.stringify(out);
})();
