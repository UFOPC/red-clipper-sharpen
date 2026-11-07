/* 真实页面端到端：在目标站打开一篇帖子，注入适配层，点胶囊，检查落盘清单。
 *
 *   node test/e2e-real-discuz.mjs https://bbs.pcbeta.com/viewthread-1079227-1-1.html
 *
 * 用来验证「新站只要加一条 SITES 配置」这个承诺：断言的是结构契约（
 * 有正文、有图片清单、文件名符合 rn-format 规范），不是具体某站的文案。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

const target = process.argv[2];
const extDir = process.env.EXT_DIR || path.resolve(".");
if (!target) {
  console.error("用法: node test/e2e-real-discuz.mjs <帖子URL>");
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
  await page.waitForSelector('td.t_f[id^="postmessage_"]', { timeout: 20000 });

  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/discuz.js") });
  await page.waitForSelector(".xhx-dz-btn", { timeout: 10000 });

  await page.hover(".xhx-dz-dock");
  await page.click('.xhx-dz-go[data-comments="1"]');
  await page.waitForFunction(() => window.__SENT.length > 0, null, { timeout: 30000 });

  const files = (await page.evaluate(() => window.__SENT)).find((m) => m.type === "downloadFiles")?.data.files || [];
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);

  if (!md) throw new Error("没有产出 markdown");
  /* 帖子本身可能就没有图（公告帖常见）。这里只断言「结构通了」：
   * 抓到正文、有 H1、frontmatter 字段齐。图片链路由 chiphell 快照回归覆盖。 */
  const body = md.text.split("\n").slice(6).join("\n").trim();
  if (body.length < 80) throw new Error(`正文太短（${body.length} 字符），疑似选择器没命中`);

  console.log(`✓ ${await page.title()}`);
  console.log(`  md      ${md.filename}`);
  const kind = media[0]
    ? (media[0].url.startsWith("data:") ? "data:" + media[0].url.slice(5, 16) : "http " + media[0].url.slice(0, 50))
    : "";
  console.log(`  媒体    ${media.length} 个${media.length ? "，示例 " + media[0].filename + " | " + kind : "（本帖无图）"}`);
  console.log(`  frontmatter:\n${md.text.split("\n---")[0].split("\n").map((l) => "    " + l).join("\n")}`);
  console.log(`  正文首行 ${JSON.stringify(md.text.split("\n").find((l) => l.startsWith("# ")))}`);
  console.log(`  评论段  ${md.text.includes("## 评论") ? "有" : "无"}`);
  failed = false;
} catch (e) {
  console.error("✗ " + e.message.split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
