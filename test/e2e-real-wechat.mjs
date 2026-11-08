/* 公众号适配端到端：真页面打开 → 注入 → 点胶囊 → 校验落盘规范。
 *
 *   node test/e2e-real-wechat.mjs https://mp.weixin.qq.com/s/XXXX
 *
 * 公众号与其它站点同一套结构：<标题>/YYYY.MM.DD_标题_公众号名.md + images/<…>-01.png + 中文 frontmatter。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

const target = process.argv[2];
const extDir = process.env.EXT_DIR || path.resolve(".");
if (!target) {
  console.error("用法: node test/e2e-real-wechat.mjs <文章URL>");
  process.exit(2);
}

const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
let failed = true;
try {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await page.addInitScript(() => {
    window.__SENT = [];
    window.__STORE = {};
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => { window.__SENT.push(msg); return null; },
      },
      storage: {
        local: {
          get: (keys, cb) => cb(window.__STORE || {}),
          set: () => {},
        },
      },
    };
  });

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#js_content", { timeout: 20000 });

  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/wechat.js") });
  await page.waitForSelector(".xhx-dz-btn", { timeout: 10000 });

  await page.evaluate(() => document.querySelector(".xhx-dz-btn").click());
  await page.waitForTimeout(3000);

  const sent = await page.evaluate(() => window.__SENT);
  if (!sent.length) {
    const statusText = await page.textContent(".xhx-dz-status").catch(() => "");
    throw new Error("没有触发下载，状态栏：" + (statusText || "<空>"));
  }

  const files = sent.find((m) => m.type === "downloadFiles")?.data.files || [];
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);
  if (!md) throw new Error("没有产出 markdown");

  const checks = [];
    checks.push(["md 路径 <标题目录>/日期_标题_公众号.md", /^[^/]+\/\d{4}\.\d{2}\.\d{2}_[^/]+\.md$/.test(md.filename)]);
    checks.push(["图片 images/ 命名", media.length > 0 && media.every((f) => /\/images\/\d{4}\.\d{2}\.\d{2}_[^/]+-\d{2}\.\w+$/.test(f.filename))]);
    checks.push(["frontmatter 中文键", /^---\n来源: 微信公众号\n/.test(md.text) && /作者: /.test(md.text) && /链接: /.test(md.text)]);
    checks.push(["正文有 H1", /^# /m.test(md.text)]);
    checks.push(["图片引用走 ./images/", media.length === 0 || /!\[\d+\]\(\.\/images\//.test(md.text)]);
  checks.push(["正文 ≥ 200 字", md.text.length > 200]);
  checks.push(["引用数 == 媒体数", (md.text.match(/!\[[^\]]*\]\(/g) || []).length === media.length]);

  console.log(`md ${md.filename}`);
  console.log(`图片 ${media.length}${media[0] ? "，示例 " + media[0].filename : ""}`);
  for (const [name, ok] of checks) console.log((ok ? "  ✓ " : "  ✗ ") + name);
  failed = checks.some(([, ok]) => !ok);
  console.log(failed ? "✗ 有断言未通过" : "✓ 全部通过");
} catch (e) {
  console.error("✗ " + e.message.split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
