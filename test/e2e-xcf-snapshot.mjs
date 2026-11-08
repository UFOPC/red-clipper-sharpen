/* 下厨房离线端到端（站方有滑块风控，自动化直连拿不到详情页）
 *
 *   SNAP="…/某菜谱.html" PW=… PW_EXE=… node test/e2e-xcf-snapshot.mjs
 *
 * 把用户保存的页面快照伪装成 https://www.xiachufang.com/recipe/107005387/ 打开，
 * location 与线上一致，选择器结论可直接搬进适配层。断言：
 *   简介 / 用料表 14 行 / 做法 30 步 / 21 张图（成品 1 + 步骤 20）、
 *   所有图片 URL 已剥掉 imageView2 缩略指令、md 引用与下发清单逐一对上。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* 别退回裸 "playwright"：ESM 不认 NODE_PATH，装不上就 ERR_MODULE_NOT_FOUND。
 * 默认给托管 node 的共享 workspace，PW 环境变量仍可覆盖。 */
const PW_DEFAULT = "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(path.resolve(process.env.PW || PW_DEFAULT)).href);
const { chromium } = pw.default ?? pw;

const html = process.env.SNAP ? fs.readFileSync(process.env.SNAP, "utf8") : null;
if (!html) {
  console.error("用法: SNAP=<菜谱页面.html> PW=… PW_EXE=… node test/e2e-xcf-snapshot.mjs");
  console.error("站方有滑块风控，自动化直连拿不到详情页，必须喂快照。");
  process.exit(2);
}
const extDir = process.env.EXT_DIR || path.resolve(".");
const URL_REAL = "https://www.xiachufang.com/recipe/107005387/";

/* 不传 executablePath 时 playwright 会去找 headless shell（本机只装了 chromium-1243），
 * 直接报 "Executable doesn't exist"。默认指到完整 chromium。 */
const browser = await chromium.launch({
  executablePath:
    process.env.PW_EXE || "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
let failed = true;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

  /* 只放行这一个文档请求，其余（图片、脚本、站点图标）全部掐掉：
   * 快照本身自包含 DOM，测试不需要真的去下载图片。 */
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(URL_REAL)) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    return route.abort();
  });

  await page.goto(URL_REAL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".steps li.container", { timeout: 10000 });

  await page.addStyleTag({ path: path.join(extDir, "content/xiachufang.css") });
  await page.addScriptTag({ path: path.join(extDir, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(extDir, "content/xiachufang.js") });
  await page.waitForSelector(".xcf-xhx-entry", { timeout: 10000 });

  /* 胶囊「存在」不等于「看得见」：曾经 appendChild 到 h1 的父容器上，
   * 而那个 div 是整篇文章的包裹层（站方 CSS 下约 7400px 高），
   * 结果胶囊被塞到正文最后一行之后——离标题三千多像素，用户根本看不到。
   * 所以位置、尺寸、标题纯净度三样都必须断言。 */
  const geo = await page.evaluate(() => {
    const slot = document.querySelector(".xcf-xhx-slot");
    const h1 = document.querySelector("h1.page-title");
    if (!slot || !h1) return null;
    const s = slot.getBoundingClientRect();
    const h = h1.getBoundingClientRect();
    const entry = slot.querySelector(".xcf-xhx-entry");
    const e = entry ? entry.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      gap: s.top - h.top,
      slotTop: s.top,
      h1Top: h.top,
      slotW: s.width,
      slotH: s.height,
      entryW: e.width,
      entryH: e.height,
    };
  });
  if (!geo) throw new Error("找不到 .xcf-xhx-slot 或 h1.page-title");
  if (Math.abs(geo.gap) >= 200) {
    throw new Error(
      `胶囊离标题 ${Math.round(geo.gap)}px，要求 < 200px（slot.y=${Math.round(geo.slotTop)} / h1.y=${Math.round(geo.h1Top)}）：` +
        "位置回落到包裹层末尾了"
    );
  }
  if (!(geo.slotW > 0 && geo.slotH > 0 && geo.entryW > 0 && geo.entryH > 0)) {
    throw new Error(`胶囊没有尺寸：slot ${geo.slotW}×${geo.slotH} / entry ${geo.entryW}×${geo.entryH}`);
  }

  await page.hover(".xcf-xhx-slot");
  await page.waitForSelector(".xcf-xhx-panel", { state: "visible", timeout: 5000 });
  await page.click(".xcf-xhx-act");
  await page.waitForFunction(
    () => window.__SENT.some((m) => m.type === "downloadFiles" && m.data.files.some((f) => f.mime === "text/markdown")),
    null,
    { timeout: 30000 }
  );

  const files = (await page.evaluate(() => window.__SENT))
    .filter((m) => m.type === "downloadFiles")
    .flatMap((m) => m.data.files);
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);
  if (!md) throw new Error("没有产出 markdown");

  /* 标题纯净度：胶囊一旦被塞进 <h1> 内部，h1.textContent 就会把面板文案
   * 「剪藏 / N 张 / 下载 / 跳过 / 保存」一起带出来，标题要进目录名和文件名，
   * 污染不可逆。所以要求标题行严格等于原文，且通篇不含面板字样。
   * （豆瓣当初踩过这个坑，这里守的是「别用 appendChild 进 h1」这条路。） */
  const h1Line = (md.text.match(/^# .*$/m) || [""])[0];
  if (h1Line !== "# 红烧肉教程集锦") throw new Error(`标题行被污染：「${h1Line}」`);
  for (const junk of ["剪藏", "下载", "跳过"]) {
    if (md.text.includes(junk)) throw new Error(`md 里混进了面板文案「${junk}」`);
  }

  if (!/^来源: 下厨房$/m.test(md.text)) throw new Error("frontmatter 缺「来源: 下厨房」");
  if (!/^作者: 愿爱常甜$/m.test(md.text)) throw new Error("作者没取到（.author a 选择器不对）");
  if (!/^时间: 2022-12-31_09:10:02$/m.test(md.text)) throw new Error("发布时间没解析出来");
  if (!md.text.includes("## 简介") || !md.text.includes("## 用料") || !md.text.includes("## 做法")) {
    throw new Error("三段结构缺了一块");
  }

  const ingRows = (md.text.match(/^\| .+ \| .+ \|$/gm) || []).length; // 表头 1 行 + 用料 14 行
  if (ingRows !== 15) throw new Error(`用料表应有 1 行表头 + 14 行数据，实际 ${ingRows}`);
  const steps = (md.text.match(/^\d+\. /gm) || []).length;
  if (steps !== 30) throw new Error(`做法应该有 30 步，实际 ${steps}`);

  const refs = [...md.text.matchAll(/!\[(\d+)\]\((\.\/images\/[^)]+)\)/g)];
  if (refs.length !== media.length) throw new Error(`md 引用 ${refs.length} 张 / 下发 ${media.length} 个，对不上`);
  if (media.length !== 21) throw new Error(`应该是 1 张成品图 + 20 张步骤图 = 21，实际 ${media.length}`);
  const thumbs = media.filter((f) => /imageView2\//.test(f.url));
  if (thumbs.length) throw new Error(`还有 ${thumbs.length} 张缩略图没剥转码指令`);
  const badExt = media.filter((f) => !/\.(jpg|png|webp|gif)$/i.test(f.filename));
  if (badExt.length) throw new Error(`扩展名不对：${badExt[0].filename}`);

  console.log(`✓ ${md.text.split("\n").find((l) => l.startsWith("# "))}`);
  console.log(`  md      ${md.filename}`);
  console.log(`  胶囊    距标题 ${Math.round(geo.gap)}px | 尺寸 ${Math.round(geo.slotW)}×${Math.round(geo.slotH)}`);
  console.log(`  媒体    ${media.length} 张，示例 ${media[0].filename} | ${media[0].url.slice(0, 60)}…`);
  console.log(`  用料    ${ingRows - 1} 行 | 做法 ${steps} 步 | 正文 ${md.text.length} 字符`);
  console.log(`  frontmatter:\n${md.text.split("\n---")[0].split("\n").map((l) => "    " + l).join("\n")}`);
  if (process.env.DUMP) console.log("\n===== md 前 40 行 =====\n" + md.text.split("\n").slice(0, 40).join("\n"));
  failed = false;
} catch (e) {
  console.error("✗ " + e.message.split("\n")[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
