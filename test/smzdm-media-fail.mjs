/* 什么值得买：媒体没发出去时，按钮必须说实话
 *
 * 这个用例守两条失败分支——它们是「界面说成功、文件里缺内容」最容易复发的地方：
 *   ① sendMessage reject（扩展重载 / SW 崩溃导致端口断开）：循环被打断，剩下的批次
 *      一张没发，failedWrite 却是空的。以前只 console.warn，按钮照旧显示「已提交」，
 *      用户以为 20/20 都发了。
 *   ② 下载器回 {failed:[…]}：条数可数，显示「N 个媒体未保存」。
 *
 * md 走的是先落语义，两条分支下都必须照发——这里也一并守住，免得修失败文案时把它弄丢。
 *
 * 桩返回的形状就是 background 的下载协议，不需要真扩展、不需要真网络。
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

/* mode: "reject" 端口断开 / "partial" 下载器回一条失败 */
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
    window.chrome = {
      runtime: {
        getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
        onMessage: { addListener() {} },
        sendMessage: (msg) => {
          window.__sent.push(msg);
          const isMd =
            msg.data && msg.data.files && msg.data.files[0] && msg.data.files[0].mime === "text/markdown";
          if (isMd) return Promise.resolve({});
          if (window.__mode === "reject") {
            return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
          }
          return Promise.resolve({
            failed: [{ filename: "测试_2026.11.02_测试作者-01.jpg", error: "HTTP 403" }],
          });
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
    mdSent: window.__sent.some(
      (m) => m.data && m.data.files && m.data.files[0] && m.data.files[0].mime === "text/markdown"
    ),
  }));
  await p.close();
  return state;
}

console.log("\n[1] sendMessage reject（端口断开）");
const a = await run("reject");
ok(a.mdSent, "md 仍然发出了（先落 md 的语义没被破坏）");
ok(a.text === "媒体下发中断", `按钮显示「媒体下发中断」（实际「${a.text}」）`);
ok(a.text !== "已提交", "不再谎报已提交");

console.log("\n[2] 下载器回 {failed:[1 条]}");
const b = await run("partial");
ok(b.text === "1 个媒体未保存", `按钮显示「1 个媒体未保存」（实际「${b.text}」）`);

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项失败` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
