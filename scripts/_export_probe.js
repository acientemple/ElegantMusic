// 探测 webpack 运行时与内部模块可达性
(async () => {
    const chunkKeys = Object.keys(window).filter((k) =>
        k.startsWith("webpackChunk"),
    );
    const out = { chunkKeys, detail: {} };
    for (const k of chunkKeys) {
        const arr = window[k];
        const last = arr[arr.length - 1];
        out.detail[k] = {
            len: arr.length,
            lastIsArray: Array.isArray(last),
            lastTypes: Array.isArray(last)
                ? last.map((x) => (typeof x === "function" ? "fn" : typeof x))
                : null,
            hasRequire:
                Array.isArray(last) &&
                typeof last[2] === "function" &&
                typeof last[2].c === "object",
        };
    }
    return JSON.stringify(out);
})();
