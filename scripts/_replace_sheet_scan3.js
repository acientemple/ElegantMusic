// 分批扫描歌单：每批单独一次 CDP 调用，避免长时间 evaluate 卡住
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const log = (...a) => console.log(...a);

    const meta = await evaluate(`(() => {
      const c = document.querySelector(".page-container");
      return c ? { sh: c.scrollHeight, ch: c.clientHeight } : null;
    })()`);
    log("容器:", JSON.stringify(meta.value || meta));

    await evaluate(`(() => { window.__scanMap = new Map(); window.__scanSeen = new Set(); return true; })()`);

    const max = (meta.value || {}).sh || 0;
    const STEP = 500;
    const BATCH = 12;
    for (let start = 0; start <= max; start += STEP * BATCH) {
        const end = Math.min(start + STEP * BATCH, max);
        const r = await evaluate(`(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const cont = document.querySelector(".page-container");
          if (!cont) return { err: "no cont" };
          for (let top = ${start}; top <= ${end}; top += ${STEP}) {
            cont.scrollTop = top;
            await sleep(70);
            for (const t of document.querySelectorAll("tr")) {
              const cells = Array.from(t.querySelectorAll("td")).map(td => (td.innerText||"").replace(/\\s+/g," ").trim()).filter(Boolean);
              if (cells.length < 2) continue;
              const k = cells.join("|");
              if (window.__scanSeen.has(k)) continue;
              window.__scanSeen.add(k);
              window.__scanMap.set(cells[0], cells);
            }
          }
          return { n: window.__scanMap.size };
        })()`);
        if (r.error) { log("批次", start, "出错:", r.error); break; }
        log("扫到", end, "px，已收集", (r.value || {}).n, "行");
        if ((r.value || {}).n >= 842) break;
    }

    const all = await evaluate(`(() => Array.from(window.__scanMap.values()).sort((a,b)=>Number(a[0])-Number(b[0])))()`);
    const rows = all.value || [];
    log("\n【总行数】", rows.length);
    log("\n前 20 行:");
    rows.slice(0, 20).forEach((c) => log("  ", JSON.stringify(c)));
    const kw = ["all of me", "john legend", "burning", "maria arredondo", "poker face", "lady gaga"];
    log("\n关键词命中:");
    for (const k of kw) {
        const hit = rows.filter((c) => c.join(" ").toLowerCase().includes(k));
        log("  [" + k + "]", hit.length, "条", JSON.stringify(hit.slice(0, 3)));
    }
    const platforms = {};
    rows.forEach((c) => { const p = c[c.length-1]; platforms[p] = (platforms[p]||0)+1; });
    log("\n平台分布:", JSON.stringify(platforms));

    fs.writeFileSync(__dirname + "/_replace_sheet_scan3.json", JSON.stringify(rows, null, 2));
    await evaluate(`(() => { document.querySelector(".page-container").scrollTop = 0; return true; })()`);
    ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
