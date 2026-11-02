/* 少数派「正文+回复」：真的把评论写进 md
 *
 * 用真实页面快照 fixtures/sspai-117510.html（2026-11 抓自 sspai.com/post/117510，
 * 6 条顶层讨论 + 嵌套回复）。图片一律跳过，只验评论这一半。
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

const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "sspai-117510.html"), "utf8");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage();

// 快照里的 script 会重新拉远端资源，把 cdn 与静态资源都指向 1x1 png
await page.route("https://cdnfile.sspai.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
await page.route("https://cdn-static.sspai.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
await page.route("https://sspai.com/**", (r) =>
  r.request().resourceType() === "document"
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE })
    : r.fulfill({ status: 200, contentType: "text/css", body: "" })
);

// 页面自己的脚本会把评论重新渲染掉，所以先把 chrome 打桩、脚本拦掉再导航
await page.route("https://sspai.com/_nuxt/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
await page.addInitScript(() => {
  window.__sent = [];
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: (msg) => {
        window.__sent.push(msg);
        return Promise.resolve({});
      },
    },
  };
  window.filesize = { filesize: (n) => Math.round(n / 1024) + " KB" };
});

await page.goto("https://sspai.com/post/117510", { waitUntil: "domcontentloaded" });
// 快照里没有我们的脚本，手动注入（顺序：先 rn-format 再 sspai）
await page.addScriptTag({ content: read("js/rn-format.js") });
await page.addScriptTag({ content: read("content/sspai.js") });

await page.waitForSelector(".sspai-xhx-slot", { timeout: 5000 });
await page.hover(".sspai-xhx-slot");
await page.waitForFunction(() => document.querySelector(".sspai-xhx-qhead .cnt")?.textContent, null, { timeout: 5000 });

const countText = await page.locator(".sspai-xhx-qhead .cnt").textContent();
ok(/^\d+ 张$/.test(countText.trim()), `张数读到了（${countText.trim()}）`);

/* 只存正文：md 里不该有「## 评论」 */
await page.click('.sspai-xhx-seg[data-group="media"] button[data-value="0"]');
await page.click('.sspai-xhx-act[data-comments="0"]');
await page.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, { timeout: 10000 });
const mdPlain = await page.evaluate(() => {
  const m = window.__sent.find((x) => x.type === "downloadFiles" && x.data.files[0].text);
  return m ? m.data.files[0].text : "";
});
ok(!!mdPlain && !mdPlain.includes("## 评论"), `「正文」不含评论区（${mdPlain.length} 字符）`);

/* 正文+回复：md 里必须有评论区，且有嵌套回复 */
await page.waitForFunction(() => !document.querySelector(".sspai-xhx-act").disabled, null, { timeout: 10000 });
await page.hover(".sspai-xhx-slot");
await page.evaluate(() => (window.__sent.length = 0));
await page.click('.sspai-xhx-act[data-comments="1"]');
await page.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, { timeout: 20000 });
const md = await page.evaluate(() => {
  const m = window.__sent.find((x) => x.type === "downloadFiles" && x.data.files[0].text);
  return m ? m.data.files[0].text : "";
});

const entries = (md.match(/^\d+\. \*\*/gm) || []).length;
ok(md.includes("## 评论"), "含「## 评论」小节");
ok(entries >= 6, `评论条数 ≥6（实际 ${entries}）`);
ok(/非常震撼/.test(md), "第一条评论正文进了 md");
ok(/^\s+- \*\*/m.test(md), "嵌套回复以列表项出现");
ok(/感谢评论，边界争议地区/.test(md), "嵌套回复正文进了 md");
ok(!/\*\*关注\*\*|关注 老麦/.test(md), "没有把「关注」按钮文字混进作者名");

console.log("\n--- md 里的评论区 ---");
console.log(md.slice(md.indexOf("## 评论")).split("\n").slice(0, 14).join("\n"));

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
