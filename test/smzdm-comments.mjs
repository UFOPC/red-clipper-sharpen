/* 什么值得买「正文+回复」：真的把评论写进 md
 *
 * 用真实页面快照 fixtures/smzdm-a4qpgkgx.html（抓自 post.smzdm.com/p/a4qpgkgx）。
 * 页面里有两个评论 tab：精彩（可见，20 条）和最新（display:none，20 条），
 * 两个都是服务端直出 —— 全读会把同一批算两遍，所以只读可见的那个。
 *
 * 图片走的是 URL 直传，不需要抓字节，只验 md 这一半。
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

const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "smzdm-a4qpgkgx.html"), "utf8");

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const page = await browser.newPage();

await page.route("https://post.smzdm.com/p/a4qpgkgx/**", (r) =>
  r.request().resourceType() === "document"
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE })
    : r.fulfill({ status: 200, contentType: "text/css", body: "" })
);
await page.route("https://am.zdmimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
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

await page.goto("https://post.smzdm.com/p/a4qpgkgx/", { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: read("js/rn-format.js") });
await page.addScriptTag({ content: read("content/smzdm.js") });
await page.waitForSelector(".xhx-zdm-slot", { timeout: 5000 });

const grabMd = () =>
  page.evaluate(() => {
    const m = window.__sent.find((x) => x.type === "downloadFiles" && x.data.files[0].text);
    return m ? m.data.files[0].text : "";
  });

const clickAct = async (which) => {
  await page.evaluate(() => (window.__sent.length = 0));
  await page.hover(".xhx-zdm-slot");
  await page.waitForFunction(() => document.querySelector(".xhx-zdm-qhead .cnt")?.textContent, null, {
    timeout: 5000,
  });
  await page.click(`.xhx-zdm-act[data-comments="${which}"]`);
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, {
    timeout: 10000,
  });
  // 等按钮复位，下一次点击才点得动
  await page.waitForFunction(() => !document.querySelector(".xhx-zdm-act").disabled, null, {
    timeout: 10000,
  });
  return grabMd();
};

/* ① 只存正文：md 里不该有评论区 */
const plain = await clickAct("0");
ok(!!plain, "「正文」产出了 md");
ok(!plain.includes("## 评论"), "「正文」不含评论区");

/* ② 正文+回复：md 里必须有评论区 */
const withC = await clickAct("1");
ok(!!withC, "「正文+回复」产出了 md");
ok(withC.includes("## 评论"), "「正文+回复」含评论区");

const section = withC.slice(withC.indexOf("## 评论"));
const items = [...section.matchAll(/^(\d+)\. \*\*(.+?)\*\*(?: · (.*))?$/gm)];
ok(items.length === 20, `只读可见 tab 的 20 条，没有把隐藏 tab 也算一遍（实际 ${items.length}）`);
ok(items.every((m) => m[2].trim()), "每条都有作者名");
ok(items[0][2] === "丶悠", `第一条作者是「丶悠」（实际「${items[0][2]}」）`);
ok(/^\d{2}-\d{2} \d{2}:\d{2}/.test(items[0][3] || ""), `时间带日期和时刻（实际「${items[0][3]}」）`);
ok((items[0][3] || "").includes("日本"), `时间后面带归属地（实际「${items[0][3]}」）`);
ok(section.includes("[无语]"), "表情还原成 alt 文字，不是丢掉");
ok(!/^\d+\. \*\*匿名\*\*/m.test(section), "没有读不出作者名的评论");

/* ③ 点胶囊仍然只存正文 */
await page.evaluate(() => (window.__sent.length = 0));
await page.hover(".xhx-zdm-slot");
await page.waitForFunction(() => document.querySelector(".xhx-zdm-qhead .cnt")?.textContent, null, {
  timeout: 5000,
});
await page.click(".xhx-zdm-entry");
await page.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, {
  timeout: 10000,
});
const oneClick = await grabMd();
ok(!!oneClick && !oneClick.includes("## 评论"), "点胶囊一键下载走的是「正文」，不含评论");

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
