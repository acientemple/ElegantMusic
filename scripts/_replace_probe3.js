// 探查：当前播放歌曲、队列面板、底部播放条
(() => {
    const out = {};
    const bar = document.querySelector(".music-detail--container");
    out.hasDetail = !!bar;
    // 底部播放条
    const bottom = document.querySelector(".bottom-player--container");
    out.bottomClass = bottom ? bottom.className : null;
    out.bottomText = bottom ? bottom.innerText.replace(/\s+/g, " ").slice(0, 200) : null;
    // 右侧面板
    const panels = Array.from(document.querySelectorAll("[class*='panel']")).map(
        (el) => ({
            cls: el.className,
            text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 80),
            visible: el.getBoundingClientRect().width > 0,
        }),
    );
    out.panels = panels.slice(0, 20);
    // 所有可能带 music-item 的行
    const songRows = Array.from(document.querySelectorAll("tr")).filter((tr) =>
        tr.querySelector("td"),
    );
    out.songRowCount = songRows.length;
    return JSON.stringify(out, null, 2);
})();
