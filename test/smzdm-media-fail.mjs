/* 什么值得买：md 必须只引用真正落盘的媒体
 *
 * 这个用例守三件事——都是「界面说成功、文件里缺内容」的复发点：
 *   ① md 在媒体之后下发：以前 md 先发，媒体失败补不进正文，正文里的图链指向一批
 *      并不存在的文件（「引用数 != 落盘数」）。这里断言 md 那条消息确实排在媒体批次之后。
 *   ② 没落盘的媒体不留引用：失败的那张图从正文里消失，其余图照常引用，并在正文末尾
 *      写明少了什么——文件自己知道缺了什么，不用回头翻控制台。
 *   ③ 按钮说实话：部分失败「N 个媒体未保存」，端口断开（sendMessage reject，整批没发、
 *      连条数都数不出来）「媒体下发中断」，都不许显示「已提交」。
 *
 * 桩必须回真实生成的文件名：反查是靠 filename 精确比对的，编一个名字会让失败项匹配不到，
 * 等于绕开被测逻辑（这条坑踩过一次）。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(EXT, p), "utf8");

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

const IMG = (n) => `https://am.zdmimg.com/202611/02/6ae86498d5820221${n}.png_e1080.jpg`;
const PAGE = `<!doctype html><meta charset="utf-8">
<title>中断测试_什么值得买</title>
<meta property="article:author" content="测试作者">
<meta property="article:published_time" content="2026-11-02T10:30:00+08:00">
<article id="articleId">
  <h1 class="item-name">中断测试</h1>
  <div class="txt-detail">
    <p>第一段正文。</p>
    <p><img src="${IMG(1)}" alt="图一"></p>
    <p><img src="${IMG(2)}" alt="图二"></p>
    <p><img src="${IMG(3)}" alt="图三"></p>
    <p>最后一段正文。</p>
  </div>
</article>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});

/* mode: "reject" 端口断开 / "partial" 只有第一张落盘失败 */
async function run(mode) {
  const p = await browser.newPage();
  await p.route("https://post.smzdm.com/p/interrupt1/**", (r) =>
    r.request().resourceType() === "document"
      ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE })
      : r.fulfill({ status: 200, contentType: "image/jpeg", body: "" })
  );
  await p.addInitScript((m) => {
    window.__mode = m;
    window.__sent = [];
    window.__md = "";
    window.__batches = [];
    window.chrome = {
      runtime: {
        getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
        onMessage: { addListener() {} },
        sendMessage: (msg) => {
          window.__sent.push(msg);
          const files = (msg.data && msg.data.files) || [];
          if (msg.type !== "downloadFiles" || !files.length) return Promise.resolve({});
          /* md 永远成功：本用例只关心媒体那侧 */
          if (files[0].mime === "text/markdown") {
            window.__md = files[0].text;
            return Promise.resolve({});
          }
          window.__batches.push(files.map((f) => f.filename));
          if (window.__mode === "reject") {
            return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
          }
          /* 回真实文件名：被测代码靠它反查是第几项 */
          return Promise.resolve({ failed: [{ filename: files[0].filename, error: "HTTP 403" }] });
        },
      },
      storage: { local: { get: (_k, cb) => cb && cb({}), set: () => {} } },
    };
  }, mode);
  await p.goto("https://post.smzdm.com/p/interrupt1/", { waitUntil: "domcontentloaded" });
  await p.addScriptTag({ content: read("js/rn-format.js") });
  await p.addScriptTag({ content: read("content/smzdm.js") });
  await p.waitForSelector(".xhx-zdm-slot", { timeout: 5000 });

  await p.hover(".xhx-zdm-slot");
  await p.waitForFunction(() => document.querySelector(".xhx-zdm-qhead .cnt")?.textContent, null, {
    timeout: 5000,
  });
  await p.click('.xhx-zdm-act[data-comments="0"]');
  await p.waitForFunction(
    () => {
      const t = document.querySelector(".xhx-zdm-act[data-comments='0']").textContent;
      return ["媒体下发中断", "1 个媒体未保存", "已提交", "md 未保存"].includes(t);
    },
    null,
    { timeout: 15000 }
  );
  const state = await p.evaluate(() => ({
    text: document.querySelector(".xhx-zdm-act[data-comments='0']").textContent,
    md: window.__md,
    batches: window.__batches,
    /* md 在 __sent 里的位置，与最后一个媒体批次的位置比：md 必须更靠后 */
    mdAt: window.__sent.findIndex(
      (m) => m.data && m.data.files && m.data.files[0] && m.data.files[0].mime === "text/markdown"
    ),
    lastMediaAt: window.__sent.reduce(
      (last, m, i) =>
        m.type === "downloadFiles" && m.data.files[0] && m.data.files[0].mime !== "text/markdown" ? i : last,
      -1
    ),
  }));
  await p.close();
  return state;
}

console.log("\n[1] sendMessage reject（端口断开）");
const a = await run("reject");
ok(a.mdAt > a.lastMediaAt, `md 仍排在媒体之后（md@${a.mdAt} > media@${a.lastMediaAt}）`);
ok(/有 3 项媒体未能保存（下发中断）/.test(a.md), "中断写进了正文：3 项全部标注未保存");
ok(!/images\//.test(a.md), "一张引用都不留（没确认落盘就不指向任何文件）");
ok(a.text === "媒体下发中断", `按钮显示「媒体下发中断」（实际「${a.text}」）`);
ok(a.text !== "已提交", "不再谎报已提交");

console.log("\n[2] 下载器回 {failed:[第一张]}");
const b = await run("partial");
ok(b.batches.length && b.batches[0].length === 3, `三个图一批发出（实际 ${b.batches[0] && b.batches[0].length}）`);
ok(b.mdAt > b.lastMediaAt, `md 排在媒体批次之后（md@${b.mdAt} > media@${b.lastMediaAt}）`);

/* 批次里是「标题/images/…」，正文里是「images/…」，只能按 basename 比——
 * 整串比会永远不中，让「失败那张没被引用」变成假通过。
 * 另外注记行本身会写出失败文件名（…（HTTP 403）），所以判「有没有引用」必须排除 > 开头的行。 */
const base = (f) => String(f || "").split("/").pop();
const bodyOnly = b.md.split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
const [f1, f2, f3] = b.batches[0] || [];
ok(f1 && !bodyOnly.includes(base(f1)), `失败那张不出现在正文里（${base(f1)}）`);
ok(f2 && bodyOnly.includes(base(f2)) && f3 && bodyOnly.includes(base(f3)), "其余两张照常引用");
ok(/有 1 项媒体未能保存/.test(b.md), "正文写明了少了 1 项");
ok(b.md.includes("HTTP 403"), "正文带上了失败原因");
ok(b.text === "1 个媒体未保存", `按钮显示「1 个媒体未保存」（实际「${b.text}」）`);

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项失败` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
