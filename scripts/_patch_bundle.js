const fs = require("fs");
const f = "D:/work/OneDrive/Desktop/MusicFree-0.0.8-win32-x64-portable/MusicFree-0.0.8-win32-x64-portable/resources/app/.webpack/renderer/main_window/index.js";
const src = fs.readFileSync(f, "utf8");
const count = src.split("lyricText:e?.lrc").length - 1;
console.log("片段出现次数:", count);
if (process.argv[2] === "old") {
    fs.writeFileSync(f, src.split("lyricText:e?.lrc").join("lyricText:e.lrc"));
    console.log("已改回旧写法（对照组）");
} else {
    const backup = "D:/work/MusicFreeDesktop/out/MusicFree-win32-x64/resources/app/.webpack/renderer/main_window/index.js";
    fs.copyFileSync(backup, f);
    console.log("已用打包产物还原");
}
console.log("校验:", fs.readFileSync(f, "utf8").includes("lyricText:e?.lrc") ? "含可选链(修复版)" : "无可选链(旧版)");
