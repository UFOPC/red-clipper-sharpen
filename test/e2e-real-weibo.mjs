/* 微博单条页真实页面端到端
 *
 *   PW=… PW_EXE=… node test/e2e-real-weibo.mjs https://m.weibo.cn/status/5359048358626912
 *
 * 断言：正文/作者/时间取到；图片地址已升级成 /large/（不是 orj360 缩略图）；
 * 每张图都通过后台代取拿到了真字节；md 引用数与下发数一致。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

const target = process.argv[2];
const extDir = process.env.EXT_DIR || path.resolve(".");
if (!target) {
  console.error("用法: node test/e2e-real-weibo.mjs <m.weibo.cn/status/…>");
  process.exit(2);
}

const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
let failed = true;
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  await page.addInitScript(() => {
    window.__SENT = [];
    window.__FETCHED = [];
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => {
          if (msg && msg.type === "fetchMedia") {
            window.__FETCHED.push(msg.data.url);
            return window.__fetchMedia(msg.data.url);
          }
          window.__SENT.push(msg);
          return null;
        },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
  });

  await page.exposeFunction("__fetchMedia", async (url) => {
    try {
      const res = await page.request.get(url, { headers: { Referer: "https://weibo.com/" } });
      if (!res.ok()) return { ok: false, error: "HTTP " + res.status() };
      return { ok: true, type: res.headers()["content-type"] || "image/jpeg", base64: (await res.body()).toString("base64") };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 120) };
    }
  });

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".weibo-text", { timeout: 20000 });

  await page.addStyleTag({ path: path.join(extDir, "content/weibo.css") });
  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/weibo.js") });
  await page.waitForSelector(".wb-xhx-entry", { timeout: 10000 });

  await page.hover(".wb-xhx-slot");
  await page.waitForSelector(".wb-xhx-panel", { state: "visible", timeout: 5000 });
  await page.click(".wb-xhx-act");
  await page.waitForFunction(
    () => window.__SENT.some((m) => m.type === "downloadFiles" && m.data.files.some((f) => f.mime === "text/markdown")),
    null,
    { timeout: 90000 }
  );

  const sent = await page.evaluate(() => ({ sent: window.__SENT, fetched: window.__FETCHED }));
  const files = sent.sent.filter((m) => m.type === "downloadFiles").flatMap((m) => m.data.files);
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);
  if (!md) throw new Error("没有产出 markdown");

  const lines = md.text.split("\n");
  const body = lines.slice(lines.indexOf("---", 1) + 1).join("\n").trim();
  if (body.length < 40) throw new Error(`正文太短（${body.length} 字符）`);
  if (!/^来源: 微博$/m.test(md.text)) throw new Error("frontmatter 缺「来源: 微博」");
  if (!/^作者: .+/m.test(md.text)) throw new Error("frontmatter 缺作者");
  if (!/^时间: \d{4}-\d{2}-\d{2}_/m.test(md.text)) throw new Error("时间没解析出来（微博页面不写年份）");

  const refs = [...md.text.matchAll(/!\[(\d+)\]\((\.\/images\/[^)]+)\)/g)];
  if (refs.length !== media.length) throw new Error(`md 引用 ${refs.length} 张 / 下发 ${media.length} 个，对不上`);
  const notData = media.filter((f) => !f.url.startsWith("data:image/"));
  if (notData.length) throw new Error(`${notData.length} 张图没拿到字节`);
  const notLarge = sent.fetched.filter((u) => !/\/large\//.test(u));
  if (notLarge.length) throw new Error(`还在抓缩略图：${notLarge[0].slice(0, 70)}`);

  console.log(`✓ ${md.text.split("\n").find((l) => l.startsWith("# "))}`);
  console.log(`  md      ${md.filename}`);
  console.log(`  媒体    ${media.length} 张，示例 ${media[0] ? media[0].filename + " | " + media[0].url.slice(0, 22) : "（纯文字微博）"}`);
  console.log(`  正文    ${body.length} 字符`);
  console.log(`  frontmatter:\n${md.text.split("\n---")[0].split("\n").map((l) => "    " + l).join("\n")}`);
  if (process.env.DUMP) console.log("\n===== md =====\n" + md.text);
  failed = false;
} catch (e) {
  console.error("✗ " + e.message.split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
