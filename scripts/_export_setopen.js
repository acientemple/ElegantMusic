// 设置「打开文件」对话框要返回的路径
(() => {
    global.__mfOpenPaths = process.argv.slice(2);
    return JSON.stringify({ openPaths: global.__mfOpenPaths });
})();
