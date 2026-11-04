// 抓渲染进程异常：派发右键菜单时是否有报错
(async () => {
    const list = await (await fetch("http://localhost:9222/json")).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const errors = [];
    const logs = [];
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
        if (msg.method === "Runtime.exceptionThrown") {
            errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
        }
        if (msg.method === "Runtime.consoleAPICalled") {
            logs.push({
                type: msg.params.type,
                text: (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300),
            });
        }
    });
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const send = (method, params) => new Promise((resolve) => {
        const msgId = ++id; pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) {
            return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
        }
        return { value: r.result?.result?.value };
    };
    await send("Runtime.enable");
    await send("Log.enable").catch(() => {});
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const disp = await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[1];
      const rect = tr.getBoundingClientRect();
      tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: Math.round(rect.x+30), clientY: Math.round(rect.y+10) }));
      return "ok";
    })()`);
    console.log("派发:", JSON.stringify(disp));
    await sleep(2500);
    const menu = await evaluate(`(() => ({
      menus: Array.from(document.querySelectorAll("[class*='context-menu']")).map(e=>e.className),
      items: Array.from(document.querySelectorAll(".menu-item")).map(e=>(e.innerText||"").replace(/\\s+/g," ").trim()),
    }))()`);
    console.log("菜单:", JSON.stringify(menu.value || menu, null, 1));
    console.log("\n异常:", JSON.stringify(errors, null, 1));
    console.log("\n控制台:", JSON.stringify(logs.slice(-15), null, 1));
    ws.close();
})();
