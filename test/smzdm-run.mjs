/* SMZDM 适配 E2E
 *
 * 不碰真站（站点有滑块风控，自动化第 6 篇左右就会拦）。
 * 做法：把真实抓下来的 post/a4qpgkgx 页面存成本地 fixture，
 * 通过 page.route 让 https://post.smzdm.com/p/a4qpgkgx/ 返回它，
 * 再把图片域名改写到本地 HTTP 服务 —— 这样 chrome.downloads 的请求
 * 会落到我们能记录、能验字节的服务器上，而页面来源仍是 post.smzdm.com，
 * content script 的匹配规则照常生效。
 *
 * 断言重点：
 *   ① 胶囊出现在 .recommend-tab 里
 *   ② 面板向左下展开（右边缘对齐胶囊，不是右伸）
 *   ③ 档位切换真的改了 URL 尾部指令（_e1080 / _fo710）
 *   ④ 下载落盘 65 图 + 1 md，扩展名与真实 MIME 一致（.png / .jpg，不是 .jpg 一刀切）
 *   ⑤ md 里作者/时间/标题来自 meta，装饰图 the-end 被跳过
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/* playwright 装在托管 node 的共享 workspace 里，ESM 不认 NODE_PATH，只能按绝对路径 require */
const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* 默认加载源码目录；给 EXT_DIR 就加载别的目录 —— 用来验解压后的 zip 产物，
 * 「验产物一律在解压后的包上做」这条约定靠它落地。 */
const EXT = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : path.resolve(HERE, "..");
const FIXTURE = path.join(HERE, "fixtures", "smzdm-a4qpgkgx.html");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

const hits = [];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  hits.push(p);
  const isPng = /\.png_/i.test(p);
  const body = isPng ? PNG : JPG;
  res.writeHead(200, {
    "Content-Type": isPng ? "image/png" : "image/jpeg",
    "Content-Length": body.length,
  });
  res.end(body);
});

const fails = [];
const ok = (cond, msg) => {
  if (cond) console.log("  PASS  " + msg);
  else {
    console.log("  FAIL  " + msg);
    fails.push(msg);
  }
};

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const IMG_BASE = `http://127.0.0.1:${PORT}`;

const raw = fs.readFileSync(FIXTURE, "utf8");
// 只换图片域名，页面结构保持原样
const pageHtml = raw.replace(/https:\/\/am\.zdmimg\.com\//g, IMG_BASE + "/");

const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhx-zdm-"));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xhx-prof-"));

const ctx = await chromium.launchPersistentContext(profile, {
  /* 本机 playwright 版本与已下载的 chromium 构建号对不上，直接指定可执行文件 */
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
  acceptDownloads: true,
  downloadsPath: dlDir,
  viewport: { width: 1440, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
  ],
});

let page = ctx.pages()[0] || (await ctx.newPage());
await page.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.startsWith("https://post.smzdm.com/p/a4qpgkgx")) {
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: pageHtml });
  }
  // 扩展自己的资源（胶囊图标）必须放行，否则会把「图标没加载」误判成产品缺陷
  if (url.startsWith("chrome-extension://")) return route.continue();
  if (url.startsWith(IMG_BASE)) return route.continue();
  return route.abort();
});

await page.goto("https://post.smzdm.com/p/a4qpgkgx/", { waitUntil: "domcontentloaded" });

console.log("\n[1] 胶囊挂载");
const entry = page.locator(".xhx-zdm-entry");
await entry.waitFor({ state: "visible", timeout: 15000 });
ok(await entry.isVisible(), "胶囊可见");
ok(
  await page.evaluate(() => !!document.querySelector("article#articleId .recommend-tab .xhx-zdm-slot")),
  "胶囊挂在 .recommend-tab 内"
);
const count = await page.locator(".xhx-zdm-qhead .cnt").textContent();
ok(/^65 张$/.test((count || "").trim()), `张数正确（读到「${count}」）`);
ok(
  await page.evaluate(() => document.querySelector(".xhx-zdm-qhead").textContent.startsWith("图片")),
  "张数挂在「图片」后面"
);
ok(
  await page.evaluate(() => {
    const img = document.querySelector(".xhx-zdm-entry img");
    return !!img && img.complete && img.naturalWidth > 0;
  }),
  "胶囊图标加载成功（web_accessible_resources 已含 post.smzdm.com）"
);

console.log("\n[2] 面板方向：应向左下");
const panel = page.locator(".xhx-zdm-panel");
ok(!(await panel.isVisible()), "初始收起");
await entry.hover();
await panel.waitFor({ state: "visible", timeout: 3000 });
const geo = await page.evaluate(() => {
  const b = document.querySelector(".xhx-zdm-entry").getBoundingClientRect();
  const p = document.querySelector(".xhx-zdm-panel").getBoundingClientRect();
  return { bx: b.x, bw: b.width, px: p.x, pw: p.width, py: p.y, by: b.y, bh: b.height };
});
ok(Math.abs(geo.px + geo.pw - (geo.bx + geo.bw)) <= 1, "面板右边缘与胶囊右边缘对齐");
ok(geo.px < geo.bx, `面板向左展开（panel.x=${geo.px} < btn.x=${geo.bx}）`);
ok(geo.py >= geo.by + geo.bh, "面板在胶囊下方");

console.log("\n[3] 档位切换");
await page.locator('.xhx-zdm-seg[data-group="mode"] button[data-value="small"]').click();
ok(
  await page.evaluate(
    () => document.querySelector('.xhx-zdm-seg[data-group="mode"] button[data-value="small"]').classList.contains("is-on")
  ),
  "710 档选中"
);
ok(
  await page.evaluate(() => document.querySelector(".xhx-zdm-slot").classList.contains("is-pinned")),
  "选中后固定，移开不收起"
);

console.log("\n[4] 下载");
hits.length = 0;
await page.locator(".xhx-zdm-act").first().click();

/* chrome.downloads 发出的请求 Playwright 不抛 download 事件，落盘是 GUID 名。
 * 所以按「文件头」判真实类型，再和 md 里的引用交叉比对 ——
 * 这比读文件名更能证明「md 引用的扩展名和实际字节一致」。 */
const snap = () =>
  fs
    .readdirSync(dlDir, { recursive: true })
    .map(String)
    .filter((f) => !/\.crdownload$/i.test(f))
    .map((f) => path.join(dlDir, f))
    .filter((f) => {
      try {
        return fs.statSync(f).isFile();
      } catch (e) {
        return false;
      }
    });

const readHead = (f) => {
  try {
    return fs.readFileSync(f);
  } catch (e) {
    return Buffer.alloc(0);
  }
};

const deadline = Date.now() + 120000;
let all = [];
while (Date.now() < deadline) {
  all = snap();
  const hasMd = all.some((f) => readHead(f).subarray(0, 3).toString() === "---");
  if (hasMd && all.length >= 66) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2000);
all = snap();

const kind = (buf) => {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.subarray(0, 3).toString() === "---") return "md";
  return "?";
};

const kinds = all.map((f) => kind(readHead(f)));
const pngN = kinds.filter((k) => k === "png").length;
const jpgN = kinds.filter((k) => k === "jpg").length;
const mdN = kinds.filter((k) => k === "md").length;

ok(pngN === 64, `64 个文件是真的 PNG（实际 ${pngN}）`);
ok(jpgN === 1, `1 个文件是真的 JPEG（实际 ${jpgN}）`);
ok(mdN === 1, `md 落盘 1 个（实际 ${mdN}）`);
ok(all.length === 66, `共 66 个文件（实际 ${all.length}）`);

ok(hits.length === 65, `服务器收到 65 次图片请求（实际 ${hits.length}）`);
ok(hits.every((h) => h.includes("_fo710.jpg")), "全部走了 _fo710 档");
ok(!hits.some((h) => /the-end/.test(h)), "装饰图 the-end 未被下载");

console.log("\n[5] md 内容");
const mdFile = all[kinds.indexOf("md")];
const md = fs.readFileSync(mdFile, "utf8");
ok(/^来源: 什么值得买$/m.test(md), "来源正确");
ok(/^作者: 大胃王DAVID$/m.test(md), "作者取自 meta[article:author]，不是评论者");
ok(/^时间: 2026-10-31_12:33:28$/m.test(md), "时间取自 meta[article:published_time]");
ok(/^链接: https:\/\/post\.smzdm\.com\/p\/a4qpgkgx\/$/m.test(md), "链接正确");
ok(md.includes("# 7年全球销量第一的爱攻AGON电竞显示器，QD-OLED双11值得冲吗？"), "标题完整且不含编辑入口残留");

const refs = md.match(/!\[\d+\]\(\.\/[^)]+\)/g) || [];
ok(refs.length === 65, `md 内 65 个图片引用（实际 ${refs.length}）`);
const refPng = refs.filter((r) => /\.png\)$/.test(r)).length;
const refJpg = refs.filter((r) => /\.jpg\)$/.test(r)).length;
ok(refPng === 64 && refJpg === 1, `引用扩展名与真实字节一致：64 .png + 1 .jpg（实际 ${refPng}/${refJpg}）`);
ok(
  refs.every((r) => /\d+\.(png|jpg)\)$/.test(r)),
  "引用形如 ./images/<stem>-NN.<ext>"
);
const stems = new Set(refs.map((r) => r.replace(/^!\[\d+\]\(\.\/images\//, "").replace(/-\d+\.(png|jpg)\)$/, "")));
ok(stems.size === 1, `65 张图共用同一 stem（${[...stems][0] || "无"}）`);
ok(refs.every((r) => r.startsWith("![") && r.includes("](./images/")), "正文图片引用全部进入 images/");
ok(![...stems].some((stem) => stem.includes("大胃王DAVID")), "正文媒体 stem 不含作者名");
/* 这个环境里的 chrome.downloads 落盘为 GUID（见上方说明），不能拿磁盘文件名反推 suggested filename；
 * 下载路径由 one-click.mjs 在消息层断言，这里只交叉核对真实字节与 md 引用。 */
ok(md.includes("## 引言："), "h2 转成二级标题");
ok(md.includes("### 1、分辨率和尺寸"), "h3 转成三级标题");
ok(md.includes("> 商品卡片"), "商品卡片留了记号");
ok(!md.includes("本内容由什么值得买官方与品牌合作推出"), "品牌合作声明已剔除");

console.log("\n[6] 设置页站点列表");
let extId = "";
for (let i = 0; i < 30 && !extId; i++) {
  const w = ctx.serviceWorkers().find((x) => x.url().startsWith("chrome-extension://"));
  if (w) extId = new URL(w.url()).host;
  else await page.waitForTimeout(200);
}
if (extId) {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/setting.html`, { waitUntil: "domcontentloaded" });
  const sites = await opt.locator(".sites li strong").allTextContents();
  ok(sites.length === 4, `设置页列出 4 个站点（${sites.join(" / ")}）`);
  ok(sites.includes("什么值得买"), "设置页含「什么值得买」");
  ok(
    (await opt.locator("#site-count").textContent()) === "4",
    "站点计数由列表数出来，不会与文案漂移"
  );
  ok((await opt.locator("#version").textContent()) === "v0.6.3", "版本号是 0.6.3");
  const tree = await opt.locator('section[aria-label="下载目录结构"] pre').textContent();
  ok(tree.includes("标题/") && !tree.includes("作者 / 标题"), "设置页目录树不再展示作者一级目录");
  ok(tree.includes("images/") && tree.includes("media/") && tree.includes("comments/"), "设置页展示三个真实媒体子目录");
  ok(tree.includes("_作者.md") && tree.includes("-comments.json") && tree.includes("-01-c1.png"), "设置页文件名示例与真实命名一致");
  await opt.close();
} else {
  ok(false, "未拿到扩展 id，跳过设置页检查");
}

console.log("\n[7] 截图");
await page.locator(".xhx-zdm-slot").evaluate((el) => el.classList.add("is-open"));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(HERE, "smzdm-panel.png") });

await ctx.close();
server.close();

console.log(`\n结果：${fails.length ? fails.length + " 项失败" : "全部通过"}`);
if (fails.length) {
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
