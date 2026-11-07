/* 公众号适配端到端：真页面打开 → 注入 → 点胶囊 → 校验落盘规范。
 *
 *   node test/e2e-real-wechat.mjs https://mp.weixin.qq.com/s/XXXXXXXX
 *
 * 断言的是「与 Wechat-Sharpen 存量同构」这件事：
 *   路径 YYYY-MM/YY-MM-DD/<标题>.md、图片 assets/<aid8>_<NNN>_<url8>.<ext>、
 *   frontmatter 键 title/source/published/created。
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
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => { window.__SENT.push(msg); return null; },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
  });

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#js_content", { timeout: 20000 });

  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/wechat.js") });
  await page.waitForSelector(".xhx-dz-btn", { timeout: 10000 });

  /* 点胶囊本体＝按默认选项（含图片）直接存，不经过面板。
   * 公众号正文很长时 dock 可能落在视口外，force 跳过可见性检查。 */
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
  checks.push(["目录 YYYY-MM/YY-MM-DD", /^\d{4}-\d{2}\/\d{2}-\d{2}-\d{2}\/.+\.md$/.test(md.filename)]);
  checks.push(["图片 assets/ 命名", media.every((f) => /\d{4}-\d{2}\/\d{2}-\d{2}-\d{2}\/assets\/[0-9a-f]{8}_\d{3}_[0-9a-f]{8}\.\w+$/.test(f.filename))]);
  checks.push(["frontmatter title", /^---\ntitle: "/.test(md.text)]);
  checks.push(["frontmatter source", /source: "https:\/\/mp\.weixin\.qq\.com\/s\//.test(md.text)]);
  checks.push(["frontmatter published", /published: "\d{4}年\d{1,2}月\d{1,2}日/.test(md.text)]);
  checks.push(["frontmatter created", /created: "\d{4}-\d{2}-\d{2}"/.test(md.text)]);
  checks.push(["正文 ≥ 200 字", md.text.length > 200]);
  checks.push(["图片引用走 assets/", md.text.includes("](assets/") || media.length === 0]);
  checks.push(["无 H1 重复标题", !/^# /m.test(md.text.split("---").slice(2).join("---"))]);

  console.log("md   " + md.filename);
  console.log("图片 " + media.length + (media[0] ? "，示例 " + media[0].filename : ""));
  for (const [name, ok] of checks) {
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }
  failed = checks.some(([, ok]) => !ok);
  console.log(failed ? "✗ 有断言未通过" : "✓ 全部通过");
  if (!failed) {
    console.log("--- 正文前 200 字 ---");
    console.log(md.text.split("---").slice(2).join("---").trim().slice(0, 200));
  }
} catch (e) {
  console.error("✗ " + e.message.split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
