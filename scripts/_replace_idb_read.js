// 从 IndexedDB 直接读 sheets + musicStore，核对歌单原始顺序与替换条目
const fs = require("fs");

(async () => {
    const list = await (await fetch("http://localhost:9222/json")).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const send = (method, params) => new Promise((resolve) => {
        const msgId = ++id; pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) {
            return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
        }
        return { value: r.result?.result?.value };
    };
    const log = (...a) => console.log(...a);

    const res = await evaluate(`(async () => {
      const open = (name) => new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const db = await open("musicSheetDB");
      const storeNames = Array.from(db.objectStoreNames);
      const readAll = (db, name) => new Promise((resolve, reject) => {
        const tx = db.transaction(name, "readonly");
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const out = { storeNames, sheets: [], musicStore: [] };
      if (storeNames.includes("sheets")) out.sheets = await readAll(db, "sheets");
      if (storeNames.includes("musicStore")) out.musicStore = await readAll(db, "musicStore");
      return out;
    })()`);

    const out = res.value;
    if (!out) { log("读取失败:", JSON.stringify(res)); ws.close(); return; }
    log("【表名】", JSON.stringify(out.storeNames));

    for (const sheet of out.sheets) {
        const list = sheet.musicList || [];
        log("\n=== 歌单:", sheet.id, "|", sheet.name || sheet.title, "| 条目数:", list.length, "===");
        const idx = list.findIndex((m) => {
            const s = JSON.stringify(m);
            return s.includes("John Legend") || s.includes("John Legend");
        });
        // 打印前 6 条与所有 完整版搜索 平台的位置
        log("前 6 条:");
        list.slice(0, 6).forEach((m, i) => log("  ", i + 1, m.platform, "@", m.id));
        const alt = list.map((m, i) => ({ i: i + 1, platform: m.platform, id: m.id })).filter((m) => m.platform === "完整版搜索");
        log("完整版搜索 条目共", alt.length, "条，位置:", JSON.stringify(alt.map((m) => m.i)));
        // 找 All of Me
        const detail = out.musicStore.filter((m) => /All of Me/i.test(m.title || "") && /John Legend/i.test(m.artist || ""));
        log("musicStore 里 All of Me / John Legend:", JSON.stringify(detail.map((m) => ({ platform: m.platform, id: m.id, title: m.title, artist: m.artist, album: m.album, duration: m.duration, ref: m["$$ref"] })), null, 1));
        // 该条目在引用列表里的位置
        detail.forEach((d) => {
            const pos = list.map((m, i) => ({ i: i + 1, m })).filter((x) => x.m.platform === d.platform && x.m.id === d.id);
            log("  → 引用列表中的位置:", JSON.stringify(pos.map((p) => p.i)));
        });
    }

    fs.writeFileSync(__dirname + "/_replace_idb.json", JSON.stringify(out, null, 2));
    ws.close();
})();
