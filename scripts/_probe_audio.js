(async () => {
    const list = await (await fetch("http://localhost:9222/json/list")).json();
    console.log("targets:", list.map(t => `${t.type} | ${t.title} | ${t.url.slice(0,80)}`));
    const page = list.find(t => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const r = await send("Runtime.evaluate", { expression: `(() => ({
      audioCount: document.querySelectorAll("audio").length,
      audioTags: Array.from(document.querySelectorAll("audio")).map(a => ({ cls: a.className, dur: a.duration, cur: a.currentTime, paused: a.paused, src: (a.src||"").slice(0,50) })),
      iframes: Array.from(document.querySelectorAll("iframe")).map(f => f.src.slice(0,80)),
      bodyHas: document.body.innerHTML.includes("<audio"),
    }))()`, returnByValue: true });
    console.log("\n", JSON.stringify(r.result?.result?.value, null, 1));
    ws.close();
})();
