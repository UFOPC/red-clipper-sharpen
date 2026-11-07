/* Discuz 通用层的回归基线：旧 chiphell.js 与新版 discuz.js 输出必须逐字节一致。
 *
 *   node test/regress-discuz.mjs <旧版扩展目录> <新版扩展目录> <chiphell 页面快照.html>
 *
 * 快照不入库（版权），自己用浏览器「另存为」一份帖子页即可。
 * 差异只允许出现在 class 名与 storage key 上，产物（文件名 / md 正文 / 图片清单）不允许变。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* playwright 不必装进仓库：PW 指向任意一份安装即可
 *   PW=file:///C:/temp/node_modules/playwright/index.js node test/regress-discuz.mjs …
 * 不设则按常规从 node_modules 解析。 */
const pw = await import(process.env.PW ? pathToFileURL(path.resolve(process.env.PW)).href : "playwright");
const { chromium } = pw.default ?? pw;

const [oldDir, newDir, fixture] = process.argv.slice(2);
if (!oldDir || !newDir || !fixture) {
  console.error("用法: node test/regress-discuz.mjs <旧版目录> <新版目录> <快照.html>");
  process.exit(2);
}

const URL_UNDER_TEST = "https://www.chiphell.com/thread-2915041-1-1.html";
const html = fs.readFileSync(fixture, "utf8");

async function run(extDir, scriptFile, prefix, withComments) {
  const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  try {
    const page = await browser.newPage();
    await page.route(URL_UNDER_TEST, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));

    await page.addInitScript(() => {
      window.__SENT = [];
      window.chrome = {
        runtime: {
          getURL: (p) => "https://www.chiphell.com/" + p,
          sendMessage: async (msg) => { window.__SENT.push(msg); return null; },
        },
        storage: { local: { get: (_key, cb) => cb({}), set: () => {} } },
      };
    });

    await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
    await page.addScriptTag({ path: path.join(extDir, scriptFile) });
    await page.waitForSelector(`.${prefix}-btn`, { timeout: 15000 });

    // 面板默认 hidden，先 hover 唤出；「正文+回复」覆盖评论分支
    await page.hover(`.${prefix}-dock`);
    await page.click(`.${prefix}-go[data-comments="${withComments ? 1 : 0}"]`);
    await page.waitForFunction(() => window.__SENT.length > 0, null, { timeout: 30000 });

    const sent = await page.evaluate(() => window.__SENT);
    const msg = sent.find((m) => m.type === "downloadFiles");
    if (!msg) throw new Error("没有捕获到 downloadFiles");
    return msg.data.files;
  } finally {
    await browser.close();
  }
}

function diff(oldFiles, newFiles) {
  const problems = [];
  if (oldFiles.length !== newFiles.length) {
    problems.push(`文件数不同: 旧 ${oldFiles.length} / 新 ${newFiles.length}`);
  }
  const n = Math.max(oldFiles.length, newFiles.length);
  for (let i = 0; i < n; i++) {
    const a = oldFiles[i];
    const b = newFiles[i];
    if (!a || !b) {
      problems.push(`#${i} 只在一侧存在: ${(a || b).filename}`);
      continue;
    }
    if (a.filename !== b.filename) problems.push(`#${i} 文件名不同:\n  旧 ${a.filename}\n  新 ${b.filename}`);
    if ((a.url || "") !== (b.url || "")) problems.push(`#${i} 图片地址不同:\n  旧 ${a.url}\n  新 ${b.url}`);
    if ((a.text || "") !== (b.text || "")) {
      const la = String(a.text || "").split("\n");
      const lb = String(b.text || "").split("\n");
      let line = 0;
      while (line < la.length && la[line] === lb[line]) line++;
      problems.push(`#${i} 正文不同（首个差异在第 ${line + 1} 行）:\n  旧 ${JSON.stringify(la[line] ?? "<EOF>")}\n  新 ${JSON.stringify(lb[line] ?? "<EOF>")}`);
    }
  }
  return problems;
}

let failed = false;
for (const withComments of [false, true]) {
  const label = withComments ? "正文+回复" : "正文";
  const before = await run(oldDir, "content/chiphell.js", "xhx-chh", withComments);
  const after = await run(newDir, "content/discuz.js", "xhx-dz", withComments);
  const problems = diff(before, after);
  if (problems.length) {
    failed = true;
    console.log(`✗ ${label}: ${problems.length} 处差异`);
    for (const line of problems) console.log("  " + line);
  } else {
    const md = before.find((f) => f.mime === "text/markdown");
    const imgs = before.filter((f) => f.url).length;
    console.log(`✓ ${label}: ${before.length} 个文件一致（${imgs} 张图，md ${md ? md.text.length : 0} 字符）`);
  }
}
process.exit(failed ? 1 : 0);
