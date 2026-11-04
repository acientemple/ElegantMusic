// 探查 window 上暴露的模块句柄
(() => {
    const keys = Object.keys(window).filter(
        (k) => k.startsWith("@") || k.includes("track") || k.includes("player") || k.includes("music"),
    );
    const out = { keys };
    try {
        const pm = window["@shared/plugin-manager"];
        const m = pm.default || pm;
        out.hasPluginManager = !!m;
        out.pmMethods = m ? Object.keys(m).slice(0, 30) : [];
    } catch (e) {
        out.err = String(e);
    }
    return JSON.stringify(out, null, 2);
})();
