// 点击「导出全部歌单」并抓取 toast 文案
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.querySelector(".side-bar-container--my-sheets");
    const target = Array.from(root.querySelectorAll(".option-btn")).find((b) =>
        (b.getAttribute("title") || "").includes("导出全部"),
    );
    if (!target) return JSON.stringify({ error: "找不到导出全部按钮" });
    target.click();
    await sleep(1500);
    const toasts = Array.from(
        document.querySelectorAll(".Toastify__toast, .Toastify__message"),
    ).map((t) => t.innerText.trim());
    return JSON.stringify({ toasts });
})();
