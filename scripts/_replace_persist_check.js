// 重启后核对：替换结果是否已落盘（旧条目没回来）
const fs = require("fs");

async function main() {
    await new Promise((r) => setTimeout(r, 6000));
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

    // 歌单：虚拟列表可能停在中间，滚动扫描所有行
    const rows = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const cont = document.querySelector("tr")?.parentElement;
      const out = new Map();
      for (let top = 0; cont && top <= cont.scrollHeight; top += 300) {
        cont.scrollTop = top; await sleep(200);
        for (const tr of document.querySelectorAll("tr")) {
          const cells = Array.from(tr.querySelectorAll("td")).map(td => (td.innerText||"").replace(/\\s+/g," ").trim()).filter(Boolean);
          if (cells.length) out.set(cells[0], cells);
        }
      }
      return Array.from(out.values());
    })()`);
    const list2 = rows.value || [];
    log("【重启后·歌单行数】", list2.length);
    const t19 = list2.find((c) => c[0] === "19");
    log("【重启后·第19行】", JSON.stringify(t19 || null));
    log("【重启后·含 All of Me 的行】");
    list2.filter((c) => c.join(" ").toLowerCase().includes("all of me")).forEach((c) => log("  ", JSON.stringify(c)));

    // 队列
    await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const p = document.querySelector(".components--panel-base");
      if (!(p && p.getBoundingClientRect().width > 0)) {
        const b = Array.from(document.querySelectorAll(".extra-btn")).find(e => e.getAttribute("title") === "播放列表");
        if (b) b.click();
        await sleep(1500);
      }
      return true;
    })()`);
    const q = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const cont = document.querySelector(".playlist--music-list-container");
      if (!cont) return { height: null, items: [] };
      const seen = new Map();
      for (let top = 0; top <= cont.scrollHeight; top += 300) {
        cont.scrollTop = top; await sleep(180);
        for (const el of document.querySelectorAll(".play-list--music-item-container")) {
          const t = (el.querySelector(".playlist--title")?.innerText||"").trim();
          const a = (el.querySelector(".playlist--artist")?.innerText||"").trim();
          const p = (el.querySelector(".playlist--platform")?.innerText||"").trim();
          if (!t) continue;
          const k = t+"|"+a+"|"+p; if (!seen.has(k)) seen.set(k, {title:t, artist:a, platform:p});
        }
      }
      const sc = document.querySelector(".playlist--music-list-scroll");
      return { height: sc ? sc.style.height : null, count: seen.size, items: Array.from(seen.values()) };
    })()`);
    const qi = q.value || { items: [] };
    log("\n【重启后·队列总高】", qi.height);
    log("【重启后·队列条目数】", qi.count);
    log("【重启后·队列里的 All of Me】", JSON.stringify((qi.items || []).filter((x) => x.title.toLowerCase().includes("all of me"))));
    log("【重启后·kuwo 平台条目数】", (qi.items || []).filter((x) => x.platform === "kuwo").length);
    log("【重启后·完整版搜索 平台条目数】", (qi.items || []).filter((x) => x.platform === "完整版搜索").length);

    fs.writeFileSync(__dirname + "/_replace_persist_check.json", JSON.stringify({ rows: list2, queue: qi }, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
