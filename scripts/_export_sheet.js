// 点开「我喜欢」歌单并统计歌曲行
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const item = Array.from(
        document.querySelectorAll(".side-bar--list-item-container"),
    ).find((el) => el.innerText.trim() === "我喜欢");
    if (!item) return JSON.stringify({ error: "找不到「我喜欢」条目" });
    item.click();
    await sleep(2500);
    const rows = Array.from(document.querySelectorAll("tr"));
    const musicRows = rows.filter((r) => r.querySelector(".music-list-operations"));
    const first = musicRows[0];
    return JSON.stringify({
        hash: location.hash,
        trCount: rows.length,
        musicRowCount: musicRows.length,
        firstRowText: first ? first.innerText.replace(/\s+/g, " ").slice(0, 120) : null,
        sheetTitle: document.querySelector(".music-list--header, .sheet-music-list--header, h1")?.innerText ?? null,
    });
})();
