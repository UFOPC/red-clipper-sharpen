/* 定向验证：Discuz 跨页抓取遇到「200 但一楼层都没有」的页面时必须留痕。
 *
 *   node test/e2e-discuz-blocked.mjs
 *
 * 背景：远景/Chiphell 有登录墙、恩山有滑块，撞上时状态码仍是 200，
 * 但解析出来 0 楼层。修复前 collect() 返回空数组，`if (!next) continue` 静默跳过，
 * md 照写、状态栏照报「已提交」，用户不知道缺页。
 *
 * 做法：不依赖真实站点（会撞风控），本地构造一篇 3 页的 Discuz 帖子，
 * page.route 把第 2 页伪造成「200 的风控验证页」，第 3 页正常。
 * 断言：md 末尾出现「第 2 页抓取失败」，且第 3 页正文被合并进来。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

/* 跨页只在「只看楼主」模式触发：authorId 来自 URL 的 ?authorid=，与按钮无关。
 * 少了这个参数，collectAll 会在 `if (!authorId) return finish()` 直接返回，
 * 根本不会去抓第 2、3 页——这个坑第一次写测试时就踩了。 */
const BASE = "https://bbs.pcbeta.com/viewthread-9999001-1-1.html?authorid=42";

const post = (n, text) => `
  <table><tbody><tr>
    <td class="t_f" id="postmessage_${n}">
      ${text}
    </td>
  </tr></tbody></table>
  <div class="authi"><a class="xw1" href="home.php?mod=space&uid=42">楼主</a></div>
  <em id="authorposton${n}">发表于 2024-1-${10 + n}</em>`;

const page1 = `<!doctype html><html><head><meta charset="utf-8"><title>三页帖</title></head><body>
  <div id="pt"><a href="/">论坛</a></div>
  <h1 id="thread_subject">三页帖</h1>
  ${post(1, "<p>第一页正文，应该有这一段。</p>")}
  <div class="pg"><a href="/viewthread-9999001-1-1.html">1</a>
    <a href="/viewthread-9999001-2-1.html">2</a>
    <a href="/viewthread-9999001-3-1.html">3</a></div>
</body></html>`;

/* 第 2 页：HTTP 200，但是风控页——没有任何 #postmessage_ 节点 */
const page2Blocked = `<!doctype html><html><head><meta charset="utf-8"><title>安全验证</title></head><body>
  <div class="alert">请完成下方的滑动验证</div>
</body></html>`;

const page3 = `<!doctype html><html><head><meta charset="utf-8"><title>三页帖</title></head><body>
  ${post(5, "<p>第三页正文，这一页是好的。</p>")}
</body></html>`;

const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
let failed = true;
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__SENT = [];
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => {
          window.__SENT.push(msg);
          return { done: 1, failed: [], cancelled: false };
        },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
  });

  await page.route("**/*", (route) => {
    const url = route.request().url();
    const html = (body) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
    /* 翻页走的是 pageUrl() 生成的 forum.php?...&page=N，不是静态化路径 */
    if (/forum\.php/.test(url)) {
      const n = new URL(url).searchParams.get("page");
      if (n === "2") return html(page2Blocked);
      if (n === "3") return html(page3);
      return html(page1);
    }
    if (/viewthread-9999001-1-1\.html/.test(url)) return html(page1);
    return route.abort();
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('td.t_f[id^="postmessage_"]', { timeout: 10000 });

  await page.addScriptTag({ path: path.resolve("js/rn-format.js") });
  await page.addScriptTag({ path: path.resolve("content/discuz.js") });
  await page.waitForSelector(".xhx-dz-btn", { timeout: 10000 });

  /* 必须点「正文」（data-comments="0"）：只有只看楼主模式才走跨页循环，
     正文+回复模式在 collectAll 里 `if (!authorId) return finish()` 直接返回。 */
  await page.hover(".xhx-dz-dock");
  await page.click('.xhx-dz-go[data-comments="0"]');
  await page.waitForFunction(() => window.__SENT.length > 0, null, { timeout: 30000 });

  const files = (await page.evaluate(() => window.__SENT)).find((m) => m.type === "downloadFiles")?.data.files || [];
  const md = files.find((f) => f.mime === "text/markdown");
  if (!md) throw new Error("没有产出 markdown");

  const text = md.text;
  const checks = [
    ["第一页正文", text.includes("第一页正文")],
    ["第三页正文（失败页之后的页仍应合并）", text.includes("第三页正文")],
    ["第 2 页失败留痕", /第\s*2\s*页抓取失败/.test(text)],
    ["注记说明风控", /风控/.test(text)],
  ];
  for (const [name, ok] of checks) {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failed = true;
  }
  if (checks.every(([, ok]) => ok)) failed = false;

  console.log("---- md 末尾 ----");
  console.log(text.trim().split("\n").slice(-6).join("\n"));
} catch (e) {
  console.error("✗ " + String(e.message || e).split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
