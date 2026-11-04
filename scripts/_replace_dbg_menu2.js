// 调试：右键菜单渲染到哪去了
(() => {
    const tr = document.querySelectorAll("tr")[1];
    const rect = tr.getBoundingClientRect();
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
    return "dispatched";
})();
