// 确认 CDP 连的是哪个页面，并列出可疑的全局变量
(async () => {
    const keys = Object.getOwnPropertyNames(window);
    const interesting = keys.filter(
        (k) =>
            /webpack|chunk|require/i.test(k) ||
            k.startsWith("__") ||
            k.startsWith("$"),
    );
    return JSON.stringify({
        href: location.href,
        title: document.title,
        bodyClass: document.body?.className,
        interesting,
        keyCount: keys.length,
    });
})();
