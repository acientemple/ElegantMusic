// 便携版复测后核对：歌单那一行是否原地替换 + 队列里旧条目是否消失
const fs = require("fs");

const PAGE_HELPERS = `
(() => {
  const txt = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__snap = {
    sheet() {
      return Array.from(document.querySelectorAll("tr")).map((tr, i) => ({
        i,
        cells: Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean),
      }));
    },
    queueHeight() {
      const el = document.querySelector(".playlist--music-list-scroll");
      return el ? el.style.height : null;
    },
    panelOpen() {
      const p = document.querySelector(".components--panel-base");
      return !!p && p.getBoundingClientRect().width > 0;
    },
  };
  window.__ensurePanel = async () => {
    if (!window.__snap.panelOpen()) {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click();
      await sleep(1500);
    }
    return window.__snap.panelOpen();
  };
  window.__findInQueue = async (needle) => {
    const cont = document.querySelector(".playlist--music-list-container");
    if (!cont) return null;
    const hits = [];
    for (let top = 0; top <= cont.scrollHeight; top += 400) {
      cont.scrollTop = top;
      await sleep(250);
      const items = Array.from(document.querySelectorAll(".play-list--music-item-container"));
      for (const el of items) {
        const t = (el.querySelector(".playlist--title")?.innerText || "").trim();
        if (t.toLowerCase().includes(needle.toLowerCase())) {
          hits.push({ title: t, artist: (el.querySelector(".playlist--artist")?.innerText || "").trim(), platform: (el.querySelector(".playlist--platform")?.innerText || "").trim() });
        }
      }
    }
    return hits;
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

    // 歌单：找到第 19 行（目标行），看是否已换成完整版
    const sheet = await evaluate("window.__snap.sheet()");
    const target = sheet.value.find((r) => r.cells[0] === "19");
    log("【歌单·第19行】", JSON.stringify(target ? target.cells : null));
    log("【歌单·渲染行数】", sheet.value.length);
    sheet.value.slice(0, 3).forEach((r) => log("  ", r.i, "|", JSON.stringify(r.cells)));

    await evaluate("window.__ensurePanel()");
    await sleep(1000);
    log("\n【队列总高】", (await evaluate("window.__snap.queueHeight()")).value);
    const hits = await evaluate(`window.__findInQueue("All of Me")`);
    log("【队列里同名的条目】", JSON.stringify(hits.value || hits, null, 1));

    fs.writeFileSync(__dirname + "/_replace_verify_portable.json", JSON.stringify({ target, sheet: sheet.value, hits: hits.value }, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
