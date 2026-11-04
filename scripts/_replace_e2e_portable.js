// 便携版复测：完整播放版本覆盖原不完整版本
// 顺序：滚到顶部 → 双击播放 → 右键 → 搜索完整版 → 开队列面板量长度 → 点候选 → 复测
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
    bar() { const b = document.querySelector(".music-bar-container"); return b ? txt(b) : null; },
    toast() { return Array.from(document.querySelectorAll(".Toastify__toast")).map(txt); },
    modal() {
      const m = document.querySelector(".modal--music-alternatives-container");
      if (!m) return null;
      return {
        items: Array.from(m.querySelectorAll(".alternative-item")).map((el, i) => ({ i, title: txt(el.querySelector(".title")), artist: txt(el.querySelector(".artist")), tags: txt(el.querySelector(".alternative-tags")) })),
        empty: txt(m.querySelector(".alternatives-empty")),
      };
    },
  };
  window.__scrollSheetTop = () => {
    let el = document.querySelector("tr")?.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 10) { el.scrollTop = 0; return el.className; }
      el = el.parentElement;
    }
    return null;
  };
  window.__ensurePanel = async () => {
    if (!window.__snap.panelOpen()) {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click();
      await sleep(1500);
    }
    return window.__snap.panelOpen();
  };
  window.__findInQueue = async (title) => {
    const cont = document.querySelector(".playlist--music-list-container");
    if (!cont) return null;
    for (let top = 0; top <= cont.scrollHeight; top += 400) {
      cont.scrollTop = top;
      await sleep(300);
      const items = Array.from(document.querySelectorAll(".play-list--music-item-container"));
      for (const el of items) {
        const t = (el.querySelector(".playlist--title")?.innerText || "").trim();
        if (t === title) {
          return { title: t, artist: (el.querySelector(".playlist--artist")?.innerText || "").trim(), platform: (el.querySelector(".playlist--platform")?.innerText || "").trim(), top: el.style.top };
        }
      }
    }
    return null;
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

    // ---- 选一行能正常播放的歌 ----
    let pick = null, barBefore = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await evaluate("window.__scrollSheetTop()");
        await sleep(1500);
        const rows = (await evaluate("window.__snap.sheet()")).value;
        const cand = rows.filter((r) => r.cells.length > 2).slice(attempt, attempt + 1)[0];
        if (!cand) break;
        await evaluate(`(() => {
          const tr = document.querySelectorAll("tr")[${cand.i}];
          tr.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
          return true;
        })()`);
        await sleep(3500);
        barBefore = (await evaluate("window.__snap.bar()")).value;
        log("尝试", attempt, JSON.stringify(cand.cells), "⇒ 底栏:", barBefore);
        if (barBefore && /\d{1,2}:\d{2}\s*\//.test(barBefore)) { pick = cand; break; }
    }
    if (!pick) { log("❌ 找不到能播放的行"); ws.close(); return; }
    const title = pick.cells[1], artist = pick.cells[2];
    log("\n目标:", title, "/", artist);

    // ---- 右键 → 搜索完整播放版本 ----
    await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[${pick.i}];
      const rect = tr.getBoundingClientRect();
      tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: Math.round(rect.x+40), clientY: Math.round(rect.y+10) }));
      return true;
    })()`);
    let menu = null;
    for (let i = 0; i < 12; i++) {
        await sleep(400);
        const m = await evaluate(`(() => Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item")).map(e => (e.innerText||"").replace(/\\s+/g," ").trim()))()`);
        if (m.value && m.value.length) { menu = m.value; break; }
    }
    log("\n【右键菜单】", JSON.stringify(menu));
    if (!menu) { log("❌ 菜单未弹出"); ws.close(); return; }

    const ok = await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item"))
        .find(e => (e.innerText||"").replace(/\\s+/g," ").trim() === "搜索完整播放版本");
      if (!el) return false; el.click(); return true;
    })()`);
    log("已点菜单项:", ok.value);

    // ---- 等候选 ----
    let modal = null;
    for (let i = 0; i < 45; i++) {
        await sleep(1000);
        const m = await evaluate("window.__snap.modal()");
        if (m.value && (m.value.items.length || m.value.empty)) { modal = m.value; break; }
    }
    log("【候选】", JSON.stringify(modal && modal.items.slice(0, 3), null, 1));
    if (!modal || !modal.items.length) { log("❌ 无候选"); ws.close(); return; }

    // ---- 弹窗开着的时候先把队列状态量好 ----
    await evaluate("window.__ensurePanel()");
    await sleep(1200);
    const qHeightBefore = await evaluate("window.__snap.queueHeight()");
    const qHit = await evaluate(`window.__findInQueue(${JSON.stringify(title)})`);
    log("\n【队列总高·前】", qHeightBefore.value);
    log("【队列中该曲】", JSON.stringify(qHit.value || qHit));

    // ---- 点第一个候选 + 轮询 toast ----
    await evaluate(`(() => { document.querySelectorAll(".modal--music-alternatives-container .alternative-item")[0].click(); return true; })()`);
    const seen = [];
    for (let i = 0; i < 40; i++) {
        await sleep(250);
        const t = await evaluate("window.__snap.toast()");
        t.value.forEach((x) => { if (!seen.includes(x)) seen.push(x); });
        if (seen.length >= 1) break;
    }
    log("\n【toast】", JSON.stringify(seen));

    await sleep(4000);
    const after = await evaluate("window.__snap.sheet()");
    const qHeightAfter = await evaluate("window.__snap.queueHeight()");
    const barAfter = await evaluate("window.__snap.bar()");
    log("\n【歌单·后】渲染行数:", after.value.length);
    after.value.slice(0, 4).forEach((r) => log(" ", r.i, "|", JSON.stringify(r.cells)));
    log("\n【队列总高·后】", qHeightAfter.value);
    log("【底栏·后】", barAfter.value);

    const qHit2 = await evaluate(`window.__findInQueue(${JSON.stringify(title)})`);
    log("【队列中同名条目·后】", JSON.stringify(qHit2.value || qHit2));

    fs.writeFileSync(__dirname + "/_replace_portable.json",
        JSON.stringify({ pick, barBefore, qHeightBefore: qHeightBefore.value, qHit: qHit.value, modal, seen, after: after.value, qHeightAfter: qHeightAfter.value, barAfter: barAfter.value, qHit2: qHit2.value }, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
