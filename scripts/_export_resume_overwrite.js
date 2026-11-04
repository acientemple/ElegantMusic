// 切换到「覆盖已有歌单」并执行恢复
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const view = document.querySelector(".setting-view--backup-container");
    if (!view) return JSON.stringify({ error: "不在设置页" });
    const radio = Array.from(view.querySelectorAll('[role="radio"]')).find((r) =>
        r.innerText.includes("覆盖"),
    );
    if (!radio) return JSON.stringify({ error: "找不到覆盖选项" });
    radio.click();
    await sleep(1200);
    const checked = Array.from(view.querySelectorAll('[role="radio"]')).map(
        (r) => ({
            text: r.innerText.trim(),
            checked: r.getAttribute("aria-checked"),
        }),
    );
    const rows = Array.from(view.querySelectorAll(".setting-row.backup-row"));
    const btn = rows[0]?.querySelectorAll('[role="button"]')[1];
    btn.click();
    await sleep(2500);
    const toasts = Array.from(
        document.querySelectorAll(".Toastify__toast, .Toastify__message"),
    ).map((t) => t.innerText.trim());
    return JSON.stringify({ checked, toasts });
})();
