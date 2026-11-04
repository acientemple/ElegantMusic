// 点击设置页里的「恢复歌单」（文件备份那一行）
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const view = document.querySelector(".setting-view--backup-container");
    if (!view) return JSON.stringify({ error: "不在设置页" });
    const rows = Array.from(view.querySelectorAll(".setting-row.backup-row"));
    const btn = rows[0]?.querySelectorAll('[role="button"]')[1];
    if (!btn) return JSON.stringify({ error: "找不到恢复歌单按钮" });
    btn.click();
    await sleep(2500);
    const toasts = Array.from(
        document.querySelectorAll(".Toastify__toast, .Toastify__message"),
    ).map((t) => t.innerText.trim());
    return JSON.stringify({
        clicked: btn.innerText.trim(),
        toasts,
        hash: location.hash,
    });
})();
