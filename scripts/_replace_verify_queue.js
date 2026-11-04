// 队列去重统计：确认旧条目消失、新条目只占一个位置、队列总数不变
const fs = require("fs");

const PAGE_HELPERS = `
(() => {
  const txt = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ensurePanel = async () => {
    const p = document.querySelector(".components--panel-base");
    if (!(p && p.getBoundingClientRect().width > 0)) {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click();
      await sleep(1500);
    }
    return true;
  };
  window.__scanQueue = async () => {
    const cont = document.querySelector(".playlist--music-list-container");
    if (!cont) return { total: null, items: [] };
    const seen = new Map();
    for (let top = 0; top <= cont.scrollHeight; top += 300) {
      cont.scrollTop = top;
      await sleep(200);
      const els = Array.from(document.querySelectorAll(".play-list--music-item-container"));
      for (const el of els) {
        const t = (el.querySelector(".playlist--title")?.innerText || "").trim();
        const a = (el.querySelector(".playlist--artist")?.innerText || "").trim();
        const p = (el.querySelector(".playlist--platform")?.innerText || "").trim();
        if (!t) continue;
        const key = t + "|" + a + "|" + p;
        if (!seen.has(key)) seen.set(key, { title: t, artist: a, platform: p, top: el.style.top });
      }
    }
    return { total: cont.querySelectorAll(".play-list--music-item-container").length, items: Array.from(seen.values()) };
  };
  return true;
})()
`;

async function main() {
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
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) {
            return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
        }
        return { value: r.result?.result?.value };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const log = (...a) => console.log(...a);

    await evaluate(PAGE_HELPERS);
    await evaluate("window.__ensurePanel()");
    await sleep(800);

    const scan = await evaluate("window.__scanQueue()");
    const items = scan.value.items || [];
    log("【队列去重后条目数】", items.length);
    log("\n含 All of Me 的条目:");
    items.filter((x) => x.title.toLowerCase().includes("all of me")).forEach((x) => log("  ", JSON.stringify(x)));
    log("\n含 kuwo 平台的条目数:", items.filter((x) => x.platform === "kuwo").length);
    log("含 完整版搜索 平台的条目数:", items.filter((x) => x.platform === "完整版搜索").length);
    log("\n前 6 条:");
    items.slice(0, 6).forEach((x, i) => log("  ", i, JSON.stringify(x)));

    fs.writeFileSync(__dirname + "/_replace_verify_queue.json", JSON.stringify(scan.value, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
