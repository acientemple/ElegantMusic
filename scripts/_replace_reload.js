// 重载渲染页，打断残留的 async 循环
(async () => {
    const list = await (await fetch("http://localhost:9222/json")).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const send = (method, params) => new Promise((resolve) => {
        const msgId = ++id; pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    console.log("reload:", JSON.stringify(await send("Page.reload", { ignoreCache: false })));
    await new Promise((r) => setTimeout(r, 8000));
    const r = await send("Runtime.evaluate", { expression: "document.querySelectorAll('tr').length", returnByValue: true });
    console.log("tr 行数:", JSON.stringify(r.result?.result?.value ?? r));
    ws.close();
})();
