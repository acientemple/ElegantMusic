// 分析 IndexedDB 导出的歌单数据
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "_replace_idb.json");
const out = JSON.parse(fs.readFileSync(file, "utf8"));

console.log("=== 歌单概览 ===");
out.sheets.forEach((s) => {
    const list = s.musicList || [];
    const alt = list.map((m, i) => ({ i: i + 1, m })).filter((x) => x.m.platform === "完整版搜索");
    console.log(
        `id=${s.id} | name=${s.name ?? s.title ?? "?"} | ${list.length} 条 | 完整版搜索 ${alt.length} 条 @ ${JSON.stringify(alt.map((x) => x.i))}`,
    );
});

console.log("\n=== 各歌单里 All of Me / John Legend 的引用 ===");
out.sheets.forEach((s) => {
    const list = s.musicList || [];
    const hits = list.map((m, i) => ({ i: i + 1, m })).filter((x) => /完整版搜索|kuwo/.test(x.m.platform) && x.m.id === "32333835" || x.m.id === "5355929");
    if (hits.length) {
        console.log(`歌单 ${s.id} (${s.name ?? s.title}) :`, JSON.stringify(hits.map((h) => `${h.i}: ${h.m.platform}@${h.m.id}`)));
    }
});

console.log("\n=== musicStore 中 All of Me 系列 ===");
out.musicStore
    .filter((m) => /John Legend/i.test(m.artist || "") && /All ?of Me/i.test(m.title || ""))
    .forEach((m) => console.log(JSON.stringify(m)));

console.log("\n=== musicStore 里带 sortIndex / timeStamp 的样本 ===");
const withSort = out.musicStore.filter((m) => Object.keys(m).some((k) => typeof k === "symbol" || k.includes("sort") || k.includes("time")));
console.log("数量:", withSort.length);
out.musicStore.slice(0, 3).forEach((m) => console.log(JSON.stringify(m)));
