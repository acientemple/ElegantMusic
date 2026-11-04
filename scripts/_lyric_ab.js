// 针对指定 kuwo 下标：等歌词加载 → 记录首句出现时刻 → seek 回 0 → 看是否抛空指针
const fs = require("fs");
const IDX = Number(process.argv[2] ?? 5);

(async () => {
    const list = await (await fetch("http://localhost:9222/json/list")).json();
    const page = list.find((t) => t.type === "page" && t.url.includes("main_window"));
    if (!page) { console.log("找不到 main_window 页面"); return; }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
        if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            exceptions.push(d?.exception?.description || d?.text || JSON.stringify(d));
        }
    });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
        return { value: r.result?.result?.value };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await send("Runtime.enable");

    await evaluate(`(() => {
        window.__errs = [];
        window.addEventListener("error", (e) => window.__errs.push((e.message || "") + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
        return true;
    })()`);

    const panel = async () => (await evaluate(`(() => ({
        items: document.querySelectorAll(".lyric-item").length,
        hi: (document.querySelector('.lyric-item[data-highlight="true"]')||{}).id || "",
        loading: !!document.querySelector(".loading-container, .loading"),
        t: window.ad ? window.ad.currentTime : null,
        bar: (document.querySelector(".music-bar-container")?.innerText || "").replace(/\\s+/g, " ").trim(),
    }))()`)).value;

    const playKuwo = async (idx) => (await evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll("tr")).filter(tr => tr.querySelectorAll("td").length > 4);
        const kuwos = [];
        for (const tr of rows) {
            const cells = Array.from(tr.querySelectorAll("td")).map(td => (td.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
            if (cells[cells.length - 1] === "kuwo") kuwos.push({ tr, cells });
        }
        const hit = kuwos[${idx}];
        if (!hit) return { err: "no kuwo", count: kuwos.length };
        hit.tr.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        return hit.cells;
    })()`)).value;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const played = await playKuwo(IDX);
        if (!played || played.err) { console.log("播放失败:", JSON.stringify(played)); break; }
        console.log(`\n[第 ${attempt} 次] 播放:`, (played || []).join(" | "));
        // 确保详情页打开
        await evaluate(`(() => { if (!document.querySelector(".lyric-item")) { const el = document.querySelector(".music-title span[role=button]"); if (el) el.dispatchEvent(new MouseEvent("click", {bubbles:true,cancelable:true})); } return true; })()`);

        let t1 = null;
        for (let i = 0; i < 300; i++) {
            await sleep(200);
            const p = await panel();
            if (p.hi) { t1 = p.t; break; }
            if (i % 25 === 0) console.log("   等待歌词…", JSON.stringify(p));
        }
        if (t1 === null) { console.log("   歌词没加载出来，重试"); await sleep(3000); continue; }
        console.log(`   首句出现在 ${t1.toFixed(2)}s`);

        exceptions.length = 0;
        await evaluate(`(() => { window.ad.currentTime = 0; return true; })()`);
        const samples = [];
        for (let i = 0; i < 15; i++) {
            await sleep(80);
            const p = await panel();
            samples.push({ t: p.t, hi: p.hi });
            if (!p.hi) break;
        }
        await sleep(1200);
        const errs = (await evaluate("window.__errs")).value || [];
        const all = [...exceptions, ...errs];
        const hitErr = all.filter((t) => /reading 'lrc'/.test(t || ""));
        console.log("   采样:", JSON.stringify(samples.slice(0, 5)));
        console.log("   window error:", JSON.stringify(errs));
        console.log("   exceptionThrown:", exceptions.length ? JSON.stringify(exceptions.map(e => String(e).split("\\n")[0])) : "无");
        console.log(hitErr.length ? "   ❌ 复现了空指针" : "   ✅ 没有空指针");
        fs.writeFileSync(__dirname + "/_lyric_ab.json", JSON.stringify({ idx: IDX, t1, samples, exceptions, errs, hitErr }, null, 2));
        break;
    }
    ws.close();
})();
