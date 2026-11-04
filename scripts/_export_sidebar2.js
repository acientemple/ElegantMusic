// 列出「我的歌单」标题行的按钮与歌单条目
(() => {
    const root = document.querySelector(".side-bar-container--my-sheets");
    if (!root) return JSON.stringify({ found: false });
    const titleRow = root.querySelector(".title");
    const btns = Array.from(titleRow.querySelectorAll(".option-btn")).map(
        (b, i) => ({ idx: i, title: b.getAttribute("title") }),
    );
    const items = Array.from(
        root.querySelectorAll(".side-bar--list-item-container"),
    ).map((el) => ({
        text: el.innerText.trim(),
        cls: el.className,
        title: el.getAttribute("title"),
    }));
    return JSON.stringify(
        { found: true, optionBtns: btns, listItems: items },
        null,
        2,
    );
})();
