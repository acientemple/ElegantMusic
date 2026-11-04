// 直接从 IndexedDB 读各歌单的 musicList 长度与前几项
(async () => {
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("musicSheetDB");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(String(req.error));
    });
    const store = db.transaction("sheets", "readonly").objectStore("sheets");
    const all = await new Promise((resolve) => {
        const r = store.getAll();
        r.onsuccess = () => resolve(r.result);
    });
    const out = all.map((s) => ({
        id: s.id,
        title: s.title ?? null,
        len: (s.musicList || []).length,
        first: (s.musicList || []).slice(0, 3).map((m) => [m.platform, m.id]),
    }));
    db.close();
    return JSON.stringify(out, null, 2);
})();
