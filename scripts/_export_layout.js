// 检查「我的歌单」标题行的按钮排布是否溢出
(() => {
    const box = document.querySelector(".side-bar-container--my-sheets");
    if (!box) return JSON.stringify({ error: "找不到我的歌单区块" });
    const titleRow = box.querySelector(".title");
    const btns = Array.from(titleRow.querySelectorAll(".option-btn"));
    const r = titleRow.getBoundingClientRect();
    const br = btns.map((b) => {
        const x = b.getBoundingClientRect();
        return {
            title: b.getAttribute("title"),
            left: Math.round(x.left),
            right: Math.round(x.right),
            width: Math.round(x.width),
            overflowRight: Math.round(x.right - r.right),
        };
    });
    const label = titleRow.querySelector(".my-sheets");
    const lr = label.getBoundingClientRect();
    return JSON.stringify({
        rowWidth: Math.round(r.width),
        labelWidth: Math.round(lr.width),
        buttons: br,
        allWithinRow: br.every((b) => b.overflowRight <= 0),
        buttonsOverlapLabel: br.some((b) => b.left < Math.round(lr.right)),
    }, null, 2);
})();
