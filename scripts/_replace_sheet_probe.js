// 探测歌单 DOM 结构 + 全量扫描当前歌单
const fs = require("fs");

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
    const log = (...a) => console.log(...a);

    const probe = await evaluate(`(() => {
      const tr = document.querySelector("tr");
      const chain = [];
      let el = tr;
      while (el && el !== document.body) {
        chain.push({ tag: el.tagName, cls: (el.className||"").toString().slice(0,80), sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop });
        el = el.parentElement;
      }
      const trs = Array.from(document.querySelectorAll("tr"));
      return {
        trCount: trs.length,
        firstRows: trs.slice(0, 4).map(t => (t.innerText||"").replace(/\\s+/g," ").trim().slice(0,80)),
        lastRows: trs.slice(-3).map(t => (t.innerText||"").replace(/\\s+/g," ").trim().slice(0,80)),
        chain,
      };
    })()`);
    log("【DOM 探测】", JSON.stringify(probe.value || probe, null, 1));

    // 全量扫描
    const scan = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const tr = document.querySelector("tr");
      let cont = tr?.parentElement;
      while (cont && !(cont.scrollHeight > cont.clientHeight + 50)) cont = cont.parentElement;
      if (!cont) return { error: "no scroll container", total: 0, rows: [] };
      const map = new Map();
      const seenKeys = new Set();
      for (let top = 0; top <= cont.scrollHeight + 1000; top += 600) {
        cont.scrollTop = top;
        await sleep(120);
        for (const t of document.querySelectorAll("tr")) {
          const cells = Array.from(t.querySelectorAll("td")).map(td => (td.innerText||"").replace(/\\s+/g," ").trim()).filter(Boolean);
          if (cells.length < 2) continue;
          const k = cells.join("|");
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          map.set(cells[0], cells);
        }
      }
      const rows = Array.from(map.values()).sort((a,b) => Number(a[0]) - Number(b[0]));
      return { scrollHeight: cont.scrollHeight, total: rows.length, rows };
    })()`);
    const s = scan.value || {};
    log("\n【扫描】scrollHeight=", s.scrollHeight, " 行数=", s.total);
    const rows = s.rows || [];
    log("\n前 25 行:");
    rows.slice(0, 25).forEach((c) => log("  ", JSON.stringify(c)));
    log("\n含 John Legend / All of Me 的行:");
    rows.filter((c) => c.join(" ").toLowerCase().includes("john legend") || c.join(" ").toLowerCase().includes("all of me")).forEach((c) => log("  ", JSON.stringify(c)));

    fs.writeFileSync(__dirname + "/_replace_sheet_scan.json", JSON.stringify(s, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
