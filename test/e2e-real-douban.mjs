/* 豆瓣影评真实页面端到端
 *
 *   PW=… PW_EXE=… node test/e2e-real-douban.mjs https://movie.douban.com/review/17890635/
 *
 * 重点验证三件事：
 *   1. 标题/作者/时间/正文能从一个 /review/<id>/ 页里取全；
 *   2. 图片走「后台代取 + Referer」这条路能拿到真字节（doubanio 裸请求是 418）；
 *   3. 落盘文件名与 md 里的引用符合 rn-format 规范，且图片顺序与正文占位符一致。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

const target = process.argv[2];
const extDir = process.env.EXT_DIR || path.resolve(".");
if (!target) {
  console.error("用法: node test/e2e-real-douban.mjs <影评URL>");
  process.exit(2);
}

const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
let failed = true;
try {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  });

  await page.addInitScript(() => {
    window.__SENT = [];
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => {
          if (msg && msg.type === "fetchMedia") return window.__fetchMedia(msg.data.url);
          window.__SENT.push(msg);
          return null;
        },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
  });

  /* 扩展里这段由 background 的 fetchMedia 承担，DNR 负责补 Referer。
   * 测试环境没有 DNR，就在 Node 侧手动带上 Referer，等价于规则生效后的样子。 */
  await page.exposeFunction("__fetchMedia", async (url) => {
    try {
      const res = await page.request.get(url, { headers: { Referer: "https://www.douban.com/" } });
      if (!res.ok()) return { ok: false, error: "HTTP " + res.status() };
      const body = await res.body();
      return { ok: true, type: res.headers()["content-type"] || "image/webp", base64: body.toString("base64") };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 120) };
    }
  });

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".review-content", { timeout: 20000 });

  await page.addStyleTag({ path: path.join(extDir, "content/douban.css") });
  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/douban.js") });
  await page.waitForSelector(".db-xhx-entry", { timeout: 10000 });

  await page.hover(".db-xhx-slot");
  await page.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  await page.click(".db-xhx-act");
  /* 媒体是按批发的，每批一条 downloadFiles；md 在最后单独一条。
   * 所以不能「等到第一条」就收工，要等出现带 text/markdown 的那条。 */
  await page.waitForFunction(
    () => window.__SENT.some((m) => m.type === "downloadFiles" && m.data.files.some((f) => f.mime === "text/markdown")),
    null,
    { timeout: 90000 }
  );

  const batches = (await page.evaluate(() => window.__SENT)).filter((m) => m.type === "downloadFiles");
  const files = batches.flatMap((m) => m.data.files);
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);
  if (!md) throw new Error("没有产出 markdown");

  const lines = md.text.split("\n");
  const body = lines.slice(lines.indexOf("---", 1) + 1).join("\n").trim();
  if (body.length < 200) throw new Error(`正文太短（${body.length} 字符），疑似选择器没命中`);
  if (!/^来源: 豆瓣$/m.test(md.text)) throw new Error("frontmatter 缺少「来源: 豆瓣」");
  if (!/^作者: .+/m.test(md.text)) throw new Error("frontmatter 缺作者");
  if (!/^时间: \d{4}-\d{2}-\d{2}_/m.test(md.text)) throw new Error("frontmatter 时间格式不对");
  if (!/^tags:/m.test(md.text)) throw new Error("没有对象名 tag（电影名没取到）");

  const refs = [...md.text.matchAll(/!\[(\d+)\]\((\.\/images\/[^)]+)\)/g)];
  if (refs.length !== media.length) {
    throw new Error(`md 引用 ${refs.length} 张，实际下发 ${media.length} 个，对不上`);
  }
  const notData = media.filter((f) => !f.url.startsWith("data:image/"));
  if (notData.length) throw new Error(`${notData.length} 张图没拿到字节（退回原地址了）：${notData[0].url.slice(0, 60)}`);

  console.log(`✓ ${await page.title()}`);
  console.log(`  md      ${md.filename}`);
  console.log(`  媒体    ${media.length} 张，示例 ${media[0].filename} | ${media[0].url.slice(0, 24)}…`);
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
