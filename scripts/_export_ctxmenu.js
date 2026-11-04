// 右键某个歌单 → 打开菜单 → 点击「导出歌单」
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = Array.from(
        document.querySelectorAll(".side-bar--list-item-container"),
    ).find((el) => el.innerText.trim().includes("非法"));
    if (!target) {
        return JSON.stringify({ error: "找不到目标歌单" });
    }
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    target.dispatchEvent(
        new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: x,
            clientY: y,
        }),
    );
    await sleep(800);

    const menu = document.querySelector(".context-menu--single-column-container");
    const items = Array.from(document.querySelectorAll(".menu-item")).map(
        (el) => ({
            text: el.innerText.trim(),
            cls: el.className,
        }),
    );
    const exportItem = items.find((it) => it.text.includes("导出歌单"));
    if (!exportItem) {
        return JSON.stringify({ menuFound: !!menu, items, error: "菜单里没有导出歌单" });
    }
    const el = Array.from(document.querySelectorAll(".menu-item")).find((e) =>
        e.innerText.trim().includes("导出歌单"),
    );
    el.click();
    await sleep(1500);
    return JSON.stringify({ items, clicked: true });
})();
