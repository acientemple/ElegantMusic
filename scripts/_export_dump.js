// 找出侧边栏相关的类名与「我的歌单」文字所在的元素
(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const sideBarEls = all.filter((el) =>
        String(el.className || "")
            .toString()
            .includes("side-bar"),
    );
    const clsSet = new Set();
    sideBarEls.forEach((el) => {
        String(el.className || "")
            .split(/\s+/)
            .filter(Boolean)
            .forEach((c) => clsSet.add(c));
    });
    // 找到含「我的歌单」文本的元素
    const mySheetsText = Array.from(
        document.querySelectorAll("div,span,button"),
    ).filter((el) => el.innerText?.trim() === "我的歌单");
    return JSON.stringify(
        {
            sideBarClasses: Array.from(clsSet).sort(),
            sideBarCount: sideBarEls.length,
            mySheetsEls: mySheetsText.map((el) => ({
                tag: el.tagName,
                cls: el.className,
                parentCls: el.parentElement?.className,
                grandCls: el.parentElement?.parentElement?.className,
                html: el.parentElement?.outerHTML.slice(0, 500),
            })),
        },
        null,
        2,
    );
})();
