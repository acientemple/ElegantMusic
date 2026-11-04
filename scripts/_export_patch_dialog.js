// 在主进程接管原生「保存/打开」对话框，把路径固定到指定目录，便于自动化验证
// 打开对话框的返回路径来自 D:/work/mf-export-test/_open_paths.json（每次调用时读取）
(() => {
    const { dialog } = require("electron");
    const path = require("path");
    const fs = require("fs");

    const exportDir = "D:/work/mf-export-test";
    fs.mkdirSync(exportDir, { recursive: true });

    global.__mfExportDir = exportDir;
    global.__mfLastSave = null;
    global.__mfLastOpen = null;

    dialog.showSaveDialog = async (options) => {
        const name = path.basename(
            (options && options.defaultPath) || "export.json",
        );
        const filePath = path.join(exportDir, name);
        global.__mfLastSave = { options, filePath };
        return { canceled: false, filePath };
    };

    dialog.showOpenDialog = async (options) => {
        global.__mfLastOpen = options || null;
        let filePaths = [];
        try {
            const cfgPath = path.join(exportDir, "_open_paths.json");
            if (fs.existsSync(cfgPath)) {
                filePaths = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            }
        } catch {}
        return { canceled: false, filePaths };
    };

    return JSON.stringify({
        patched: true,
        exportDir,
        note: "打开对话框路径来自 _open_paths.json",
    });
})();
