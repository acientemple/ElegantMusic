// 调试：右键菜单为什么没弹出
(() => {
    const tr = document.querySelectorAll("tr")[1];
    const rect = tr.getBoundingClientRect();
    const info = {
        trExists: !!tr,
        trClass: tr ? tr.className : null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        trCount: document.querySelectorAll("tr").length,
        rowText: tr ? tr.innerText.replace(/\s+/g, " ").trim().slice(0, 60) : null,
    };
    tr.dispatchEvent(
        new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: Math.round(rect.x + 30),
            clientY: Math.round(rect.y + 10),
        }),
    );
    info.hasReactProps = !!(tr && Object.keys(tr).find((k) => k.startsWith("__react")));
    return JSON.stringify(info, null, 1);
})();
