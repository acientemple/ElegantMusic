// 用正确的滚动容器全量扫描歌单
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

    const scan = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const cont = document.querySelector(".page-container");
      if (!cont) return { error: "no page-container" };
      const map = new Map();
      const seen = new Set();
      const max = cont.scrollHeight;
      for (let top = 0; top <= max; top += 400) {
        cont.scrollTop = top;
        await sleep(90);
        for (const t of document.querySelectorAll("tr")) {
          const cells = Array.from(t.querySelectorAll("td")).map(td => (td.innerText||"").replace(/\\s+/g," ").trim()).filter(Boolean);
          if (cells.length < 2) continue;
          const k = cells.join("|");
          if (seen.has(k)) continue;
          seen.add(k);
          map.set(cells[0], cells);
        }
      }
      cont.scrollTop = 0;
      const rows = Array.from(map.values()).sort((a,b) => Number(a[0]) - Number(b[0]));
      return { scrollHeight: max, total: rows.length, rows };
    })()`);
    const s = scan.value || {};
    log("【扫描】scrollHeight=", s.scrollHeight, "行数=", s.total);
    const rows = s.rows || [];
    log("\n前 25 行:");
    rows.slice(0, 25).forEach((c) => log("  ", JSON.stringify(c)));
    log("\n末 5 行:");
    rows.slice(-5).forEach((c) => log("  ", JSON.stringify(c)));
    const kw = ["all of me", "john legend", "burning", "maria arredondo", "poker face", "lady gaga"];
    log("\n关键词命中:");
    for (const k of kw) {
        const hit = rows.filter((c) => c.join(" ").toLowerCase().includes(k));
        log("  [" + k + "]", hit.length, "条:", JSON.stringify(hit.slice(0, 4)));
    }
    const platforms = {};
    rows.forEach((c) => { const p = c[c.length-1]; platforms[p] = (platforms[p]||0)+1; });
    log("\n平台分布:", JSON.stringify(platforms));

    fs.writeFileSync(__dirname + "/_replace_sheet_scan2.json", JSON.stringify(s, null, 2));
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
