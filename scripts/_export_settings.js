// dump 设置页里的备份区域结构
(() => {
    const view = document.querySelector(".setting-view--backup-container");
    if (!view) {
        return JSON.stringify({ error: "没找到备份区域", html: document.body.innerHTML.slice(0, 500) });
    }
    const rows = Array.from(view.querySelectorAll(".setting-row")).map((r) => ({
        cls: r.className,
        text: r.innerText.replace(/\s+/g, " ").trim(),
        buttons: Array.from(r.querySelectorAll('[role="button"]')).map((b) =>
            b.innerText.trim(),
        ),
    }));
    const radios = Array.from(
        view.querySelectorAll('input[type="radio"], .radio-item, [role="radio"]'),
    ).map((r) => ({
        tag: r.tagName,
        cls: r.className,
        value: r.value,
        checked: r.checked,
        text: r.innerText?.trim(),
        parentText: r.parentElement?.innerText?.replace(/\s+/g, " ").trim(),
    }));
    return JSON.stringify({ rows, radios, html: view.innerHTML.slice(0, 1500) }, null, 2);
})();
