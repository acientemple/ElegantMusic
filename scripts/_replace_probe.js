// 探查当前 dev 应用状态：路由、侧边栏歌单、当前列表内容
(() => {
    const route = location.hash || location.pathname;
    const sheets = Array.from(
        document.querySelectorAll(".side-bar--list-item-container"),
    ).map((el) => el.innerText.trim());
    const rows = Array.from(document.querySelectorAll("tr"))
        .map((tr) => {
            const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
                td.innerText.trim(),
            );
            return tds.filter(Boolean).join(" | ");
        })
        .filter((t) => t && t.length < 200)
        .slice(0, 12);
    return JSON.stringify(
        {
            route,
            sheets,
            rowCount: document.querySelectorAll("tr").length,
            rows,
            hasModal: !!document.querySelector(".modal--music-alternatives-container"),
        },
        null,
        2,
    );
})();
