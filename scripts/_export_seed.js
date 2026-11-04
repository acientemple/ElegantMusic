// 往 musicSheetDB 写入导出测试数据：
// - 一个带 Windows 非法字符的歌单名
// - 一个空歌单
// - 一个引用了「已失效歌曲」的歌单（musicStore 里查不到 → bulkGet 返回 undefined）
(async () => {
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("musicSheetDB");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(String(req.error));
    });

    const songs = [
        {
            platform: "本地",
            id: "song-1",
            title: "测试歌曲一",
            artist: "测试歌手甲",
            album: "测试专辑",
            duration: 180,
            artwork: "",
            $$ref: 1,
        },
        {
            platform: "本地",
            id: "song-2",
            title: "测试歌曲二",
            artist: "测试歌手乙",
            album: "测试专辑",
            duration: 200,
            artwork: "",
            $$ref: 1,
        },
        {
            platform: "本地",
            id: "song-3",
            title: "测试歌曲三",
            artist: "测试歌手丙",
            album: "测试专辑",
            duration: 220,
            artwork: "",
            $$ref: 1,
        },
        {
            platform: "本地",
            id: "song-4",
            title: "测试歌曲四",
            artist: "测试歌手丁",
            album: "测试专辑",
            duration: 240,
            artwork: "",
            $$ref: 1,
        },
    ];

    const tx = db.transaction(["sheets", "musicStore"], "readwrite");
    const sheetsStore = tx.objectStore("sheets");
    const musicStore = tx.objectStore("musicStore");
    songs.forEach((s) => musicStore.put(s));

    sheetsStore.put({
        id: "test-export-a",
        title: '测试/歌单:*非法?"<>|字符',
        artist: "测试作者",
        platform: "本地",
        createAt: Date.now(),
        musicList: [
            { platform: "本地", id: "song-1" },
            { platform: "本地", id: "song-2" },
            { platform: "本地", id: "missing-song" },
            { platform: "本地", id: "song-3" },
        ],
        $$sortIndex: 1,
    });

    sheetsStore.put({
        id: "test-export-b",
        title: "空歌单测试",
        artist: "",
        platform: "本地",
        createAt: Date.now(),
        musicList: [],
        $$sortIndex: 2,
    });

    const def = await new Promise((resolve) => {
        const r = sheetsStore.get("favorite");
        r.onsuccess = () => resolve(r.result);
    });
    def.musicList = [
        { platform: "本地", id: "song-1" },
        { platform: "本地", id: "song-4" },
    ];
    sheetsStore.put(def);

    await new Promise((resolve) => {
        tx.oncomplete = resolve;
    });
    db.close();

    return JSON.stringify({
        seeded: true,
        songs: songs.length,
        sheets: ["favorite", "test-export-a", "test-export-b"],
        note: "test-export-a 含 1 条失效引用 missing-song",
    });
})();
