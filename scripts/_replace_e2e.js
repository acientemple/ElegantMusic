// 端到端验证：选中完整播放版本后覆盖原不完整版本
// 步骤：歌单快照 → 双击播放 → 打开队列 → 快照队列 → 右键 → 搜索完整播放版本 → 点候选 → 复快照
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
        top: el.style.top,
        title: txt(el.querySelector(".playlist--title")),
        artist: txt(el.querySelector(".playlist--artist")),
        platform: txt(el.querySelector(".playlist--platform")),
        playing: el.style.color ? getComputedStyle(el).color : "",
      }));
    },
    bar() {
      const bar = document.querySelector(".music-bar-container");
      return bar ? txt(bar) : null;
    },
    toast() {
      return Array.from(document.querySelectorAll(".Toastify__toast")).map((e) => txt(e));
    },
    modal() {
      const m = document.querySelector(".modal--music-alternatives-container");
      if (!m) return null;
      return {
        subtitle: txt(m.querySelector(".alternatives-subtitle")),
        items: Array.from(m.querySelectorAll(".alternative-item")).map((el, i) => ({
          i,
          title: txt(el.querySelector(".title")),
          artist: txt(el.querySelector(".artist")),
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
    const page = list.find(
        (t) => t.type === "page" && !t.url.startsWith("devtools://"),
    );
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    await new Promise((res, rej) => {
        ws.addEventListener("open", res);
        ws.addEventListener("error", rej);
    });
    const send = (method, params) =>
        new Promise((resolve) => {
            const msgId = ++id;
            pending.set(msgId, resolve);
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (r.result?.exceptionDetails) {
            return {
                error:
                    r.result.exceptionDetails.exception?.description ||
                    r.result.exceptionDetails.text,
            };
        }
        return { value: r.result?.result?.value };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const log = (...a) => console.log(...a);

    await evaluate(PAGE_HELPERS);

    // ---- 0. 初始状态 ----
    const before = await evaluate("window.__snap.sheet()");
    log("【歌单·前】行数:", before.value.length);
    log(JSON.stringify(before.value.slice(0, 3), null, 1));

    // ---- 1. 双击第 1 行（Westlife）播放 ----
    const target = before.value.findIndex((r) => r.cells.length > 2);
    log("\n目标行 tr 下标:", target, JSON.stringify(before.value[target]?.cells));

    await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[${target}];
      tr.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(3000);

    // ---- 2. 打开播放队列面板 ----
    await evaluate(`(() => {
      const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(1200);
    const queueBefore = await evaluate("window.__snap.queue()");
    log("\n【队列·前】可见条目数:", queueBefore.value.length);
    log(JSON.stringify(queueBefore.value.slice(0, 3), null, 1));
    const barBefore = await evaluate("window.__snap.bar()");
    log("【底栏·前】", barBefore.value);

    // ---- 3. 右键目标行 ----
    await evaluate(`(() => {
      const tr = document.querySelectorAll("tr")[${target}];
      tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2 }));
      return true;
    })()`);
    await sleep(800);
    const menuFound = await evaluate(`(() => {
      const items = Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item")).map(e => (e.innerText||"").replace(/\\s+/g," ").trim());
      return items;
    })()`);
    log("\n【右键菜单】", JSON.stringify(menuFound.value));

    // ---- 4. 点「搜索完整播放版本」----
    const clicked = await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(".context-menu--single-column-container .menu-item"))
        .find(e => (e.innerText||"").replace(/\\s+/g," ").trim() === "搜索完整播放版本");
      if (!el) return false;
      el.click();
      return true;
    })()`);
    log("已点击「搜索完整播放版本」:", clicked.value);
    if (!clicked.value) {
        ws.close();
        return;
    }

    // ---- 5. 等候选 ----
    let modal = null;
    for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const m = await evaluate("window.__snap.modal()");
        if (m.value && m.value.items.length) {
            modal = m.value;
            break;
        }
        if (m.value && m.value.empty) {
            modal = m.value;
            break;
        }
    }
    log("\n【候选弹窗】", JSON.stringify(modal, null, 1));
    if (!modal || !modal.items.length) {
        log("❌ 没有候选，流程中止");
        ws.close();
        return;
    }

    // ---- 6. 点第一个候选 ----
    await evaluate(`(() => {
      const el = document.querySelectorAll(".modal--music-alternatives-container .alternative-item")[0];
      el.click();
      return true;
    })()`);
    log("\n>>> 已点第一个候选，等待替换…");
    await sleep(4000);

    // ---- 7. 复快照 ----
    const after = await evaluate("window.__snap.sheet()");
    const queueAfter = await evaluate("window.__snap.queue()");
    const barAfter = await evaluate("window.__snap.bar()");
    const toast = await evaluate("window.__snap.toast()");

    log("\n【歌单·后】行数:", after.value.length);
    log(JSON.stringify(after.value.slice(0, 3), null, 1));
    log("\n【队列·后】可见条目数:", queueAfter.value.length);
    log(JSON.stringify(queueAfter.value.slice(0, 3), null, 1));
    log("\n【底栏·后】", barAfter.value);
    log("\n【toast】", JSON.stringify(toast.value));

    fs.writeFileSync(
        __dirname + "/_replace_result.json",
        JSON.stringify(
            {
                before: before.value,
                queueBefore: queueBefore.value,
                barBefore: barBefore.value,
                modal,
                after: after.value,
                queueAfter: queueAfter.value,
                barAfter: barAfter.value,
                toast: toast.value,
            },
            null,
            2,
        ),
    );
    log("\n已写入 scripts/_replace_result.json");
    ws.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
