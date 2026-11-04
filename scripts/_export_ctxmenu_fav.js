// 右键「我喜欢」→ 导出歌单（默认歌单也应可导出）
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = Array.from(
        document.querySelectorAll(".side-bar--list-item-container"),
    ).find((el) => el.innerText.trim() === "我喜欢");
    if (!target) return JSON.stringify({ error: "找不到「我喜欢」" });
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
        new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
        }),
    );
    await sleep(800);
    const items = Array.from(document.querySelectorAll(".menu-item")).map(
        (el) => el.innerText.trim(),
    );
    const el = Array.from(document.querySelectorAll(".menu-item")).find((e) =>
        e.innerText.trim().includes("导出歌单"),
    );
    if (!el) return JSON.stringify({ items, error: "菜单里没有导出歌单" });
    el.click();
    await sleep(1500);
    return JSON.stringify({ items, clicked: true });
})();
