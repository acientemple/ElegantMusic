// 切到「追加到已有歌单末尾」并恢复，然后对比恢复前后的歌单
(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("musicSheetDB");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(String(req.error));
    });
    const dump = async () => {
        const store = db.transaction("sheets", "readonly").objectStore("sheets");
        const all = await new Promise((resolve) => {
            const r = store.getAll();
            r.onsuccess = () => resolve(r.result);
        });
        return all.map((s) => ({
            id: s.id,
            title: s.title ?? null,
            musicListLen: (s.musicList || []).length,
        }));
    };
    const view = document.querySelector(".setting-view--backup-container");
    if (!view) return JSON.stringify({ error: "不在设置页" });
    const radio = Array.from(view.querySelectorAll('[role="radio"]')).find((r) =>
        r.innerText.includes("追加"),
    );
    if (!radio) return JSON.stringify({ error: "找不到追加选项" });
    radio.click();
    await sleep(1200);
    const radios = Array.from(view.querySelectorAll('[role="radio"]')).map((r) => ({
        text: r.innerText.trim(),
        checked: r.getAttribute("aria-checked"),
    }));
    const before = await dump();
    const rows = Array.from(view.querySelectorAll(".setting-row.backup-row"));
    const btn = rows[0]?.querySelectorAll('[role="button"]')[1];
    btn.click();
    await sleep(3000);
    const after = await dump();
    const toasts = Array.from(
        document.querySelectorAll(".Toastify__toast, .Toastify__message"),
    ).map((t) => t.innerText.trim());
    db.close();
    return JSON.stringify({ radios, before, after, toasts }, null, 2);
})();
