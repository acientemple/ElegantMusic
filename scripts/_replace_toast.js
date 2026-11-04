(() => {
    const all = Array.from(document.querySelectorAll("[class*='Toastify']")).map(
        (e) => e.className,
    );
    const bodyKids = Array.from(document.body.children)
        .map((e) => e.className)
        .filter(Boolean);
    return JSON.stringify({ toastify: all, bodyKids }, null, 1);
})();
