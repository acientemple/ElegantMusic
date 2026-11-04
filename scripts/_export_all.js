// 点击「导出全部歌单」按钮
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.querySelector(".side-bar-container--my-sheets");
    const btns = Array.from(root.querySelectorAll(".option-btn"));
    const target = btns.find((b) =>
        (b.getAttribute("title") || "").includes("导出全部"),
    );
    if (!target) {
        return JSON.stringify({ error: "找不到导出全部按钮" });
    }
    target.click();
    await sleep(1500);
    return JSON.stringify({ clicked: true, title: target.getAttribute("title") });
})();
