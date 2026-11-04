// 列出「我喜欢」每一行的完整信息，用于挑选测试目标
(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const out = rows.map((tr, i) => {
        const tds = Array.from(tr.querySelectorAll("td"));
        const txt = tds.map((td) => (td.innerText || "").replace(/\s+/g, " ").trim());
        const dur = tds.map((td) => {
            const s = (td.innerText || "").trim();
            return /^\d{1,2}:\d{2}$/.test(s) ? s : null;
        });
        return {
            i,
            cells: txt.filter(Boolean),
            duration: dur.filter(Boolean)[0] || null,
        };
    });
    return JSON.stringify(
        { route: location.hash, count: out.length, rows: out },
        null,
        1,
    );
})();
