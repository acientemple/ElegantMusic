// 导出侧边栏「我的歌单」区块的 DOM 结构
(() => {
    const root = document.querySelector(".side-bar-container--my-sheets");
    if (!root) {
        return JSON.stringify({ found: false });
    }
    const btns = Array.from(root.querySelectorAll(".option-btn")).map((b) => ({
        title: b.getAttribute("title"),
        icon: b.querySelector("svg")?.getAttribute("class") || null,
        html: b.innerHTML.slice(0, 120),
    }));
    const items = Array.from(
        root.querySelectorAll(".side-bar--list-item-container"),
    ).map((el) => ({
        text: el.innerText.trim(),
        cls: el.className,
    }));
    const disclosureTitle = root.querySelector(".title");
    return JSON.stringify(
        {
            found: true,
            optionBtns: btns,
            listItems: items,
            titleHtml: disclosureTitle
                ? disclosureTitle.innerHTML.replace(/\s+/g, " ").slice(0, 400)
                : null,
        },
        null,
        2,
    );
})();
