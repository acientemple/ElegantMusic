// 找到「设置」入口并进入设置页
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const all = Array.from(document.querySelectorAll("div,span,button,svg,i"));
    const cands = all.filter((el) => {
        const t = (el.getAttribute?.("title") || el.innerText || "").trim();
        return t === "设置" || t === "Settings";
    });
    if (!cands.length) {
        return JSON.stringify({ error: "找不到设置入口" });
    }
    const el = cands[cands.length - 1];
    el.click();
    await sleep(1500);
    return JSON.stringify({
        clicked: el.tagName + "." + el.className,
        hash: location.hash,
        title: document.title,
    });
})();
