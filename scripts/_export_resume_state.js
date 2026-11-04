// 恢复前后的歌单状态快照
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
        const store2 = db.transaction("musicStore", "readonly").objectStore("musicStore");
        const musics = await new Promise((resolve) => {
            const r = store2.getAll();
            r.onsuccess = () => resolve(r.result);
        });
        return {
            sheets: all.map((s) => ({
                id: s.id,
                title: s.title ?? null,
                musicListLen: (s.musicList || []).length,
            })),
            musicStore: musics.map((m) => [m.platform, m.id]),
        };
    };
    const before = await dump();
    const view = document.querySelector(".setting-view--backup-container");
    const radios = Array.from(view.querySelectorAll('[role="radio"]')).map((r) => ({
        text: r.innerText.trim(),
        checked: r.getAttribute("aria-checked"),
    }));
    const rows = Array.from(view.querySelectorAll(".setting-row.backup-row"));
    const btn = rows[0]?.querySelectorAll('[role="button"]')[1];
    if (!btn) return JSON.stringify({ error: "找不到恢复歌单按钮", radios });
    btn.click();
    await sleep(3000);
    const after = await dump();
    const toasts = Array.from(
        document.querySelectorAll(".Toastify__toast, .Toastify__message"),
    ).map((t) => t.innerText.trim());
    db.close();
    return JSON.stringify({ radios, before, after, toasts }, null, 2);
})();
