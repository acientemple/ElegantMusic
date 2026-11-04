// 查看主进程记录的保存对话框调用
(() => {
    const fs = require("fs");
    const info = global.__mfLastSave;
    if (!info) {
        return JSON.stringify({ saved: false });
    }
    const exists = fs.existsSync(info.filePath);
    let size = null;
    if (exists) size = fs.statSync(info.filePath).size;
    return JSON.stringify(
        {
            saved: true,
            dialogTitle: info.options?.title,
            defaultPath: info.options?.defaultPath,
            filePath: info.filePath,
            exists,
            size,
        },
        null,
        2,
    );
})();
