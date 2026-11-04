// 验证：① 重载后歌单替换是否落盘 ② 播放队列面板分支（只换队列，不动歌单）
const fs = require("fs");

const PAGE_HELPERS = `
(() => {
  const txt = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim();
  window.__snap = {
    sheet() {
      return Array.from(document.querySelectorAll("tr")).map((tr, i) => {
        const cells = Array.from(tr.querySelectorAll("td"))
          .map((td) => (td.innerText || "").replace(/\\s+/g, " ").trim())
          .filter(Boolean);
        return { i, cells };
      });
    },
    queue() {
      return Array.from(document.querySelectorAll(".play-list--music-item-container")).map((el, i) => ({
        i,
        title: txt(el.querySelector(".playlist--title")),
        artist: txt(el.querySelector(".playlist--artist")),
        platform: txt(el.querySelector(".playlist--platform")),
      }));
    },
    bar() { const b = document.querySelector(".music-bar-container"); return b ? txt(b) : null; },
    toast() { return Array.from(document.querySelectorAll(".Toastify__toast")).map(txt); },
    modal() {
      const m = document.querySelector(".modal--music-alternatives-container");
      if (!m) return null;
      return {
        subtitle: txt(m.querySelector(".alternatives-subtitle")),
        items: Array.from(m.querySelectorAll(".alternative-item")).map((el, i) => ({
          i, title: txt(el.querySelector(".title")), artist: txt(el.querySelector(".artist")),
          tags: txt(el.querySelector(".alternative-tags")),
        })),
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

    // ---------- ① 重载，验证落盘 ----------
    log(">>> 重载渲染进程…");
    await send("Page.enable");
    await send("Page.reload", { ignoreCache: false });
    await sleep(9000);
    await evaluate(PAGE_HELPERS);
    const reloaded = await evaluate("window.__snap.sheet()");
    log("【重载后·歌单】行数:", reloaded.value.length);
    log(JSON.stringify(reloaded.value.slice(0, 3), null, 1));

    // ---------- ② 重建队列 ----------
    const target = reloaded.value.findIndex((r) => r.cells.length > 2);
    await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[${target}];
      tr.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(3000);
    await evaluate(`(() => {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(1200);
    const qBefore = await evaluate("window.__snap.queue()");
    log("\n【队列·前】", qBefore.value.length, "条");
    qBefore.value.forEach((q) => log(" ", q.i, "|", q.title, "|", q.artist, "|", q.platform));

    // 找到目标队列项（Tony Hillman）
    const qIdx = qBefore.value.findIndex((q) => q.artist === "Tony Hillman");
    log("\n目标队列下标:", qIdx);

    // ---------- ③ 在队列面板里右键 → 搜索完整播放版本 ----------
    await evaluate(`(() => {
      const items = document.querySelectorAll(".play-list--music-item-container");
      const el = items[${qIdx}];
      if (!el) return false;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: r.x + 20, clientY: r.y + 10 }));
      return true;
    })()`);
    await sleep(900);
    const menu = await evaluate(`(() => Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item")).map(e => (e.innerText||"").replace(/\\s+/g," ").trim()))()`);
    log("【队列右键菜单】", JSON.stringify(menu.value));

    const clicked = await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item"))
        .find(e => (e.innerText||"").replace(/\\s+/g," ").trim() === "搜索完整播放版本");
      if (!el) return false;
      el.click(); return true;
    })()`);
    log("已点击菜单项:", clicked.value);
    if (!clicked.value) { ws.close(); return; }

    let modal = null;
    for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const m = await evaluate("window.__snap.modal()");
        if (m.value && (m.value.items.length || m.value.empty)) { modal = m.value; break; }
    }
    log("\n【候选】", JSON.stringify(modal && modal.items.slice(0, 3), null, 1));
    if (!modal || !modal.items.length) { log("❌ 无候选"); ws.close(); return; }

    // 选第 2 个候选（与歌单里已替换的那首不同）
    await evaluate(`(() => {
      document.querySelectorAll(".modal--music-alternatives-container .alternative-item")[1].click();
      return true;
    })()`);
    log(">>> 已点第 2 个候选");
    await sleep(4000);

    const qAfter = await evaluate("window.__snap.queue()");
    const sheetAfter = await evaluate("window.__snap.sheet()");
    const bar = await evaluate("window.__snap.bar()");
    const toast = await evaluate("window.__snap.toast()");

    log("\n【队列·后】", qAfter.value.length, "条");
    qAfter.value.forEach((q) => log(" ", q.i, "|", q.title, "|", q.artist, "|", q.platform));
    log("\n【歌单·后】行数:", sheetAfter.value.length, "第1行:", JSON.stringify(sheetAfter.value[1]?.cells));
    log("\n【底栏】", bar.value);
    log("\n【toast】", JSON.stringify(toast.value));

    fs.writeFileSync(__dirname + "/_replace_result2.json",
        JSON.stringify({ reloaded: reloaded.value, qBefore: qBefore.value, qIdx, modal, qAfter: qAfter.value, sheetAfter: sheetAfter.value, bar: bar.value, toast: toast.value }, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
