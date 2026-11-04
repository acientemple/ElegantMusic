// 边界：旧条目不在播放队列里 ⇒ 追加播放（队列 +1），歌单仍然原地替换
// 同时高频轮询捕获 toast（应用里 toast 只显示 1 秒）
const fs = require("fs");

const PAGE_HELPERS = `
(() => {
  const txt = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim();
  window.__snap = {
    sheet() {
      return Array.from(document.querySelectorAll("tr")).map((tr, i) => ({
        i,
        cells: Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean),
      }));
    },
    queue() {
      return Array.from(document.querySelectorAll(".play-list--music-item-container")).map((el, i) => ({
        i, title: txt(el.querySelector(".playlist--title")), artist: txt(el.querySelector(".playlist--artist")), platform: txt(el.querySelector(".playlist--platform")),
      }));
    },
    bar() { const b = document.querySelector(".music-bar-container"); return b ? txt(b) : null; },
    toast() { return Array.from(document.querySelectorAll(".Toastify__toast")).map(txt); },
    modal() {
      const m = document.querySelector(".modal--music-alternatives-container");
      if (!m) return null;
      return {
        subtitle: txt(m.querySelector(".alternatives-subtitle")),
        items: Array.from(m.querySelectorAll(".alternative-item")).map((el, i) => ({ i, title: txt(el.querySelector(".title")), artist: txt(el.querySelector(".artist")), tags: txt(el.querySelector(".alternative-tags")) })),
        empty: txt(m.querySelector(".alternatives-empty")),
      };
    },
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

    // ---- 队列当前状态 ----
    await evaluate(`(() => {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click(); return !!b;
    })()`);
    await sleep(1000);
    const q0 = await evaluate("window.__snap.queue()");
    log("【队列·初始】", q0.value.length, "条");

    // ---- 把 Tony Hillman（歌单第 1 行）从队列里删掉 ----
    const qIdx = q0.value.findIndex((q) => q.artist === "Tony Hillman");
    log("Tony Hillman 在队列下标:", qIdx);
    const removed = await evaluate(`(() => {
      const el = document.querySelectorAll(".play-list--music-item-container")[${qIdx}];
      const btn = el.querySelector(".playlist--remove");
      if (!btn) return false;
      btn.click(); return true;
    })()`);
    log("已从队列删除:", removed.value);
    await sleep(1500);
    const q1 = await evaluate("window.__snap.queue()");
    log("【队列·删除后】", q1.value.length, "条");

    // ---- 在歌单里右键第 1 行 → 搜索完整播放版本 ----
    const sheet = await evaluate("window.__snap.sheet()");
    const sIdx = sheet.value.findIndex((r) => r.cells.length > 2);
    log("\n歌单目标行:", sIdx, JSON.stringify(sheet.value[sIdx].cells));

    await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[${sIdx}];
      tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2 }));
      return true;
    })()`);
    await sleep(800);
    await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item"))
        .find(e => (e.innerText||"").replace(/\\s+/g," ").trim() === "搜索完整播放版本");
      if (!el) return false; el.click(); return true;
    })()`);

    let modal = null;
    for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const m = await evaluate("window.__snap.modal()");
        if (m.value && (m.value.items.length || m.value.empty)) { modal = m.value; break; }
    }
    log("【候选】", JSON.stringify(modal && modal.items.slice(0, 2), null, 1));
    if (!modal || !modal.items.length) { log("❌ 无候选"); ws.close(); return; }

    // ---- 点候选，同时高频轮询 toast ----
    await evaluate(`(() => { document.querySelectorAll(".modal--music-alternatives-container .alternative-item")[0].click(); return true; })()`);
    const seen = [];
    for (let i = 0; i < 40; i++) {
        await sleep(250);
        const t = await evaluate("window.__snap.toast()");
        t.value.forEach((x) => { if (!seen.includes(x)) seen.push(x); });
        if (seen.length >= 2) break;
    }
    log("\n【捕获到的 toast】", JSON.stringify(seen));

    await sleep(3000);
    const q2 = await evaluate("window.__snap.queue()");
    const sheet2 = await evaluate("window.__snap.sheet()");
    const bar = await evaluate("window.__snap.bar()");
    log("\n【队列·后】", q2.value.length, "条");
    q2.value.forEach((q) => log(" ", q.i, "|", q.title, "|", q.artist, "|", q.platform));
    log("\n【歌单·后】行数:", sheet2.value.length, "第1行:", JSON.stringify(sheet2.value[1]?.cells));
    log("\n【底栏】", bar.value);

    fs.writeFileSync(__dirname + "/_replace_result3.json",
        JSON.stringify({ q0: q0.value, qIdx, q1: q1.value, modal, seen, q2: q2.value, sheet2: sheet2.value, bar: bar.value }, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
