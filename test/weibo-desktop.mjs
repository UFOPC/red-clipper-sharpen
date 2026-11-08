/* 微博桌面版单条（/detail/<mid>）离线用例
 *
 *   PW=… PW_EXE=… node test/weibo-desktop.mjs
 *
 * 页面与接口都由 page.route 提供，不依赖外网或登录态。这里守的是：
 * 固定浮层、接口字段到 Markdown 的装配、长文/转发/组图、失败时零下发、首页不注入。
 * 接口在真实登录态下是否可用、字段是否与线上返回一致，不在这个离线用例的证明范围内。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const PW_DEFAULT = "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(path.resolve(process.env.PW || PW_DEFAULT)).href);
const { chromium } = pw.default ?? pw;

const EXT = process.env.EXT_DIR || path.resolve(".");
const BROWSER =
  process.env.PW_EXE || "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";

const MID = "5359048358626912";
const DETAIL_URL = `https://weibo.com/detail/${MID}`;
const HOME_URL = "https://weibo.com/";
const AUTHOR = "桌面测试作者";
const TRUNCATED_TEXT = "截断版正文不应采用";
const LONG_TEXT = "长文正文第一段\n长文正文第二段 #桌面话题#";
const ORIGINAL_TEXT = "原帖正文";
const IMG1 = "https://wx1.sinaimg.cn/large/desktop-a.jpg";
const IMG2 = "https://wx2.sinaimg.cn/orj480/desktop-b.png";
const ORIGINAL_IMG = "https://wx3.sinaimg.cn/large/original-c.jpg";

const showFixture = {
  ok: 1,
  id: MID,
  text_raw: TRUNCATED_TEXT,
  created_at: "Sat Nov 08 10:12:00 +0800 2026",
  user: { screen_name: AUTHOR },
  isLongText: true,
  pics: [{ large: { url: IMG1 } }, { url: IMG2 }],
  retweeted_status: {
    user: { screen_name: "原帖作者" },
    text_raw: ORIGINAL_TEXT,
    pics: [{ large: { url: ORIGINAL_IMG } }],
  },
};
const longTextFixture = { ok: 1, longText: { longTextContent: LONG_TEXT } };
const minimalHtml = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main>桌面版页面占位</main></body></html>`;

const fails = [];
const check = (name, cond) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name);
  if (!cond) fails.push(name);
};

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

async function openPage(url, options = {}) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__SENT = [];
    window.__FAKE_JPEG =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
    window.chrome = {
      runtime: {
        getURL: (file) => location.origin + "/" + file,
        sendMessage: async (msg) => {
          window.__SENT.push(msg);
          if (msg && msg.type === "fetchMedia") {
            return { ok: true, type: "image/jpeg", base64: window.__FAKE_JPEG };
          }
          return { done: (msg.data.files || []).length, failed: [], cancelled: false };
        },
      },
    };
  });

  /* 先全拦，再注册接口与页面；Playwright 后注册的路由优先匹配。 */
  await page.route("**/*", (route) => route.abort());
  await page.route("https://weibo.com/ajax/statuses/show**", (route) => {
    if (options.showStatus === 403) {
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: 0 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(showFixture) });
  });
  await page.route("https://weibo.com/ajax/statuses/longtext**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longTextFixture) })
  );
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: minimalHtml(url) })
  );

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.addStyleTag({ path: path.join(EXT, "content/weibo.css") });
  await page.addScriptTag({ path: path.join(EXT, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(EXT, "content/weibo-desktop.js") });
  return page;
}

const sentOf = (page) => page.evaluate(() => window.__SENT);
const mdSent = (page) =>
  page.waitForFunction(
    () =>
      window.__SENT.some(
        (msg) => msg.type === "downloadFiles" && (msg.data.files || []).some((file) => file.mime === "text/markdown")
      ),
    null,
    { timeout: 20000 }
  );

try {
  console.log("\n[1] /detail/<mid>：固定浮层与面板");
  const page = await openPage(DETAIL_URL);
  await page.waitForSelector(".wbd-xhx-slot", { timeout: 10000 });
  const floating = await page.evaluate(() => {
    const slot = document.querySelector(".wbd-xhx-slot");
    const rect = slot.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      position: getComputedStyle(slot).position,
      inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      hitOwnSlot: !!(hit && hit.closest(".wbd-xhx-slot")),
    };
  });
  check("胶囊 position: fixed", floating.position === "fixed");
  check("胶囊完整位于视口内", floating.inViewport);
  check("elementFromPoint 命中胶囊自身", floating.hitOwnSlot);
  await page.hover(".wbd-xhx-slot");
  await page.waitForSelector(".wb-xhx-panel", { state: "visible", timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".wb-xhx-panel .cnt").textContent === "3 张");
  check("面板图片计数含原帖图，共 3 张", true);

  console.log("\n[2] 保存后的 Markdown 与媒体装配");
  await page.click(".wb-xhx-act");
  await mdSent(page);
  const messages = await sentOf(page);
  const files = messages.filter((msg) => msg.type === "downloadFiles").flatMap((msg) => msg.data.files || []);
  const md = files.find((file) => file.mime === "text/markdown");
  const mediaFiles = files.filter((file) => file.url);
  if (!md) throw new Error("没有产出 markdown");
  const text = md.text;

  check("frontmatter 有「来源: 微博」", /^来源: 微博$/m.test(text));
  check(`作者来自 user.screen_name（实际「${(/^作者: (.*)$/m.exec(text) || [])[1]}」）`, /^作者: 桌面测试作者$/m.test(text));
  check("created_at 解析到 2026-11-08", /^时间: 2026-11-08_/m.test(text));
  check("正文采用 longtext 完整内容", text.includes("长文正文第一段") && text.includes("长文正文第二段"));
  check("没有退回 text_raw 截断版", !text.includes(TRUNCATED_TEXT));
  check("转发引用块保留原帖作者与正文", text.includes(`> 转发自 @原帖作者：${ORIGINAL_TEXT}`));

  const refs = [...text.matchAll(/!\[(\d+)\]\(/g)];
  check(`md 引用数 ${refs.length} == 下发媒体数 ${mediaFiles.length} == 3`, refs.length === 3 && mediaFiles.length === 3);
  check(
    `每个媒体 url 都是 data:image/（共 ${mediaFiles.length} 个）`,
    mediaFiles.length === 3 && mediaFiles.every((file) => String(file.url).startsWith("data:image/"))
  );
  const fetched = messages.filter((msg) => msg.type === "fetchMedia").map((msg) => msg.data.url);
  check("取图顺序为本条两张、原帖一张", JSON.stringify(fetched) === JSON.stringify([IMG1, IMG2, ORIGINAL_IMG]));
  check("原帖图接着编号为第 3 张", /!\[3\]\(/.test(text));

  await page.close();

  console.log("\n[3] 反向：statuses/show 返回 403 → 失败且零下发");
  const forbidden = await openPage(DETAIL_URL, { showStatus: 403 });
  await forbidden.waitForSelector(".wbd-xhx-slot", { timeout: 10000 });
  await forbidden.hover(".wbd-xhx-slot");
  await forbidden.click(".wb-xhx-act");
  await forbidden.waitForFunction(() => document.querySelector(".wb-xhx-act").textContent === "失败");
  await forbidden.waitForTimeout(600);
  const failedMessages = await sentOf(forbidden);
  check(
    `downloadFiles 为 0 条（实际 ${failedMessages.filter((msg) => msg.type === "downloadFiles").length}）`,
    failedMessages.filter((msg) => msg.type === "downloadFiles").length === 0
  );
  check(
    `也没有发起 fetchMedia（实际 ${failedMessages.filter((msg) => msg.type === "fetchMedia").length}）`,
    failedMessages.filter((msg) => msg.type === "fetchMedia").length === 0
  );
  await forbidden.close();

  console.log("\n[4] 反向：首页不注入胶囊");
  const home = await openPage(HOME_URL);
  await home.waitForTimeout(1800);
  const count = await home.evaluate(() => document.querySelectorAll(".wbd-xhx-slot").length);
  check(`首页胶囊数量为 0（实际 ${count}）`, count === 0);
  await home.close();
} catch (e) {
  console.error("✗ " + String((e && e.message) || e).split("\n")[0]);
  fails.push("异常中断");
} finally {
  await browser.close();
}

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
