// 找到 webpack 的 __webpack_require__ 并检查模块缓存
(async () => {
    const g = window["webpackHotUpdatemusicfree_desktop"];
    const out = { isArray: Array.isArray(g), len: g?.length };
    if (!Array.isArray(g)) return JSON.stringify(out);
    const last = g[g.length - 1];
    out.lastIsArray = Array.isArray(last);
    out.lastLen = Array.isArray(last) ? last.length : null;
    const runtime = Array.isArray(last) ? last[2] : null;
    out.runtimeType = typeof runtime;
    out.runtimeKeys =
        runtime && typeof runtime === "object" ? Object.keys(runtime).slice(0, 30) : null;
    out.hasCache =
        runtime && typeof runtime === "object" && runtime.c
            ? Object.keys(runtime.c).length
            : null;
    // 也看看第 0 项
    const first = g[0];
    out.firstLen = Array.isArray(first) ? first.length : null;
    out.firstTypes = Array.isArray(first)
        ? first.map((x) => (typeof x === "function" ? "fn" : typeof x))
        : null;
    const r0 = Array.isArray(first) ? first[2] : null;
    out.firstRuntimeType = typeof r0;
    out.firstRuntimeKeys =
        r0 && typeof r0 === "object" ? Object.keys(r0).slice(0, 30) : null;
    return JSON.stringify(out);
})();
