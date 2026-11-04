// 在 Electron 主进程里执行 JS（Node inspector，端口 9229）
// 用法: node scripts/main-cdp.js <file.js>
const fs = require("fs");

async function evalInMain(expression) {
    const list = await (
        await fetch("http://127.0.0.1:9229/json/list")
    ).json();
    const target = list.find((t) => t.webSocketDebuggerUrl);
    if (!target) {
        throw new Error("主进程 inspector 未就绪");
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();

    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });

    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
    });

    const send = (method, params) =>
        new Promise((resolve) => {
            const msgId = ++id;
            pending.set(msgId, resolve);
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });

    const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        includeCommandLineAPI: true,
    });
    ws.close();

    if (result.result?.exceptionDetails) {
        return {
            error:
                result.result.exceptionDetails.exception?.description ||
                result.result.exceptionDetails.text,
        };
    }
    return { value: result.result?.result?.value };
}

(async () => {
    const expr = fs.readFileSync(process.argv[2], "utf8");
    const out = await evalInMain(expr);
    if (out.error) {
        console.log("❌ " + out.error);
    } else {
        console.log(
            typeof out.value === "string"
                ? out.value
                : JSON.stringify(out.value, null, 2),
        );
    }
})();
