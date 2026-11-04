// dump musicSheetDB 的歌单记录原始内容
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
    db.close();
    return JSON.stringify(
        all.map((s) => ({
            id: s.id,
            title: s.title,
            hasTitleKey: Object.prototype.hasOwnProperty.call(s, "title"),
            artist: s.artist,
            platform: s.platform,
            musicListLen: (s.musicList || []).length,
            keys: Object.keys(s),
        })),
        null,
        2,
    );
})();
