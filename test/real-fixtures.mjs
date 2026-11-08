/* 真实页面快照回归（2026-11-08 用户 Ctrl+S 存下来的两页）
 *
 *   PW=… PW_EXE=… node test/real-fixtures.mjs
 *
 * 为什么要用真快照：这两个页面从开发机完全打不开（豆瓣 /topic/ 回 403
 * 「没有访问权限」、下厨房直接弹滑动验证），所以前面所有用例都是自造 HTML。
 * 2026-11-08 用户实测两页都显示「未识别」，自造结构全绿却抓不到问题——正因为
 * 真实模板和建模结构不是一回事：
 *   豆瓣 /topic/<id>/ 是**个人动态页**（h1.topic-title 是空壳，作者在 .article-meta）
 *   下厨房 /recipe/<id>/?recipe_type=1 是**视频菜谱**（没有 .steps、没有 .ings）
 * 这两条只有真快照能守住，合成 DOM 再怎么写都是自说自话。
 *
 * 快照处理：剥掉 <script>（我们只要 DOM，页面脚本会阻塞解析），外链一律 abort。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PW_DEFAULT = "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(path.resolve(process.env.PW || PW_DEFAULT)).href);
const { chromium } = pw.default ?? pw;

const EXT = process.env.EXT_DIR || path.resolve(".");
const BROWSER =
  process.env.PW_EXE || "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";

const DOUBAN_URL = "https://www.douban.com/topic/502558660/";
const XCF_URL = "https://www.xiachufang.com/recipe/107357520/";

/* 快照里的原始事实（从 HTML 里逐条核过，别改成「看起来合理」的值） */
const DOUBAN = {
  author: "被绵羊蒙了心",
  day: "2026.10.15",
  tag: "我的旅行日记",
  bodyHead: "这周趁着天气好又去绍兴了",
  /* 相册不在 DOM 里：整组图在 window._CONFIG.topic.photos，17 张（2 张 is_live 实况）。
   * 这个数字是从快照的 _CONFIG 里数出来的（grep '"image":{' 得 17），别凭印象改。 */
  images: 17,
};
const XCF = {
  author: "小妖凌薇姐",
  day: "2024.06.11",
  cover: "437615a0af8d4c92981cc44362532c55",
  vod: "/vod_video/1262633/",
  images: 1,
};

const fails = [];
const check = (name, cond) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name);
  if (!cond) fails.push(name);
};

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

/* 一次装好 4 样：chrome mock、样式、命名库、适配器。与 douban-topic.mjs 同一套路。 */
async function openPage(fixture, url, cssName, jsName) {
  /* 只剥**外链** script（离线跑不去拉 CDN 上的包），保留内联的——
   * 豆瓣把相册塞在内联 script 的 window._CONFIG.topic 里，
   * 一起剥掉就测不到「从 _CONFIG 取图」这条路径了。 */
  const html = fs
    .readFileSync(path.join(EXT, "test/fixtures", fixture), "utf8")
    .replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, "");
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__SENT = [];
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => {
          if (msg && msg.type === "fetchMedia") {
            return { ok: true, type: "image/jpeg", base64: window.__FAKE_JPEG };
          }
          window.__SENT.push(msg);
          return { done: (msg.data.files || []).length, failed: [], cancelled: false };
        },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
    window.__FAKE_JPEG =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  });
  await page.route("**/*", (route) => route.abort());
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
  );
  await page.goto(url, { waitUntil: "commit", timeout: 30000 });
  await page.addStyleTag({ path: path.join(EXT, "content", cssName) });
  await page.addScriptTag({ path: path.join(EXT, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(EXT, "content", jsName) });
  await page.waitForSelector(".xhx-entry, [class$='-xhx-entry']", { timeout: 15000 });
  return page;
}

const sentOf = (page) => page.evaluate(() => window.__SENT);
const mdOf = async (page) => {
  await page.waitForFunction(
    () =>
      window.__SENT.some(
        (m) => m.type === "downloadFiles" && (m.data.files || []).some((f) => f.mime === "text/markdown")
      ),
    null,
    { timeout: 20000 }
  );
  const files = (await sentOf(page))
    .filter((m) => m.type === "downloadFiles")
    .flatMap((m) => m.data.files || []);
  return { md: files.find((f) => f.mime === "text/markdown"), media: files.filter((f) => f.url) };
};

const save = async (page, entry, act) => {
  await page.hover(entry);
  await page.waitForSelector(act.replace("-act", "-panel"), { state: "visible", timeout: 5000 });
  await page.click(act);
};

/* 下厨房那组单独成函数：快照可能被清理，缺了就整段跳过。 */
async function runXcf() {
  console.log("\n[2] 下厨房 /recipe/<id>/（视频菜谱，无 .steps / .ings）");
  const xc = await openPage("xiachufang-107357520.html", XCF_URL, "xiachufang.css", "xiachufang.js");
  check("胶囊出现（没有 .steps 也照样注入）", (await xc.locator(".xcf-xhx-entry").count()) === 1);

  await xc.hover(".xcf-xhx-slot");
  await xc.waitForSelector(".xcf-xhx-panel", { state: "visible", timeout: 5000 });
  const xcCnt = ((await xc.textContent(".xcf-xhx-panel .cnt")) || "").trim();
  check(`面板计数为「${XCF.images} 张」（实际「${xcCnt}」）`, xcCnt === `${XCF.images} 张`);

  await save(xc, ".xcf-xhx-entry", ".xcf-xhx-act");
  const xcOut = await mdOf(xc);
  if (!xcOut.md) throw new Error("视频菜谱页没有产出 markdown");
  const xcText = xcOut.md.text;

  check("md 里有简介", xcText.includes("不用放冰箱"));
  check(`作者取自 .author a（实际「${(/^作者: (.*)$/m.exec(xcText) || [])[1]}」）`,
    new RegExp(`^作者: ${XCF.author}$`, "m").test(xcText));
  check(`时间取自 .time（文件名「${xcOut.md.filename}」）`, xcOut.md.filename.includes(XCF.day));
  check(`md 里写明这是视频菜谱并留了原页地址（含 ${XCF.vod}）`,
    xcText.includes("## 视频") && xcText.includes(XCF.vod));
  check(`封面下发 1 张（实际 ${xcOut.media.length}）`, xcOut.media.length === XCF.images);
  /* 缩略指令必须剥掉：留着 imageView2/2/w/660 存下来的是 660 宽的缩图。 */
  check(
    `封面 url 已剥掉 imageView2（实际「${(xcOut.media[0] || {}).url}」）`,
    !!xcOut.media[0] && xcOut.media[0].url.includes(XCF.cover) && !/imageView2/.test(xcOut.media[0].url)
  );
  check("md 里没有「未识别」这类占位", !xcText.includes("未识别"));
  await xc.close();
}

try {
  /* ---------------- 豆瓣：个人动态页 ---------------- */
  console.log("\n[1] 豆瓣 /topic/<id>/（个人动态页，h1 空壳）");
  const db = await openPage("douban-topic-502558660.html", DOUBAN_URL, "douban.css", "douban.js");
  check("胶囊出现（h1 没有文字也能挂上）", (await db.locator(".db-xhx-entry").count()) === 1);

  /* 空 h1 不能当挂载点：胶囊会悬在标题空白处，和作者/正文脱节。 */
  const host = await db.evaluate(() => {
    const s = document.querySelector(".db-xhx-slot");
    return s && s.parentElement ? String(s.parentElement.className) : "";
  });
  check(`胶囊挂在 .article-meta（实际「${host}」）`, host.includes("article-meta"));

  await db.hover(".db-xhx-slot");
  await db.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  const dbCnt = ((await db.textContent(".db-xhx-panel .cnt")) || "").trim();
  check(`面板计数为「${DOUBAN.images} 张」（实际「${dbCnt}」）`, dbCnt === `${DOUBAN.images} 张`);

  await save(db, ".db-xhx-entry", ".db-xhx-act");
  const dbOut = await mdOf(db);
  if (!dbOut.md) throw new Error("豆瓣动态页没有产出 markdown");
  const dbText = dbOut.md.text;

  check(`正文抓到了（含「${DOUBAN.bodyHead}」）`, dbText.includes(DOUBAN.bodyHead));
  check(`作者取自 a.author-name（实际「${(/^作者: (.*)$/m.exec(dbText) || [])[1]}」）`,
    new RegExp(`^作者: ${DOUBAN.author}$`, "m").test(dbText));
  check(`时间取自 .topic-meta .create-time（文件名「${dbOut.md.filename}」）`,
    dbOut.md.filename.includes(DOUBAN.day));
  check(`tags 取 .gallery 的话题名（实际「${(/^\s+- .*$/m.exec(dbText) || [])[0] || "(无)"}」）`,
    new RegExp(`^\\s+- "${DOUBAN.tag}"$`, "m").test(dbText));
  /* 没有标题时用正文首句当标题（与微博单条同一口径），且不能超 24 字。 */
  const dbTitle = (/^# (.*)$/m.exec(dbText) || [])[1] || "";
  check(`标题由正文首句兜底（实际「${dbTitle}」）`,
    dbTitle.startsWith(DOUBAN.bodyHead) && dbTitle.length <= 24);
  check("没有标题时不会退化成「未识别」空 md", !/^来源: 豆瓣$/m.test(dbText) || dbTitle.length > 0);
  check("正文里没有夹进评论区内容", !dbText.includes("回复"));
  /* 相册图在 _CONFIG 里，DOM 里没有 <img>：这条守的是「从内联 script 取图」那条路径。 */
  const dbRefs = [...dbText.matchAll(/!\[(\d+)\]\(/g)];
  check(`相册 ${DOUBAN.images} 张全部转成 md 引用（实际 ${dbRefs.length} 处）`,
    dbRefs.length === DOUBAN.images);
  check(`下发媒体数 == 引用数（实际 ${dbOut.media.length} / ${dbRefs.length}）`,
    dbOut.media.length === DOUBAN.images && dbRefs.length === dbOut.media.length);
  /* 字节走后台 fetchMedia（doubanio 认 Referer），所以 url 会是 data: 而不是原地址；
   * 这里验的是「17 张都过了那条通道」且文件名不重复（重复会让覆盖静默吃掉一张）。 */
  check("17 张都走 fetchMedia 转成 data:image/",
    dbOut.media.length > 0 && dbOut.media.every((f) => String(f.url).startsWith("data:image/")));
  check("17 个文件名互不重复",
    new Set(dbOut.media.map((f) => f.filename)).size === dbOut.media.length);
  await db.close();

  /* ---------------- 下厨房：视频菜谱 ---------------- */
  /* 快照可能被清理掉（test/fixtures 不入库）。缺了就跳过，不要让整个用例红：
   * 这条守的是「视频菜谱没有 .steps 也能存」，用户已实测通过，
   * 但快照在才能守住回归。重新 Ctrl+S 存回同名文件即可自动恢复。 */
  const xcfFixture = path.join(EXT, "test/fixtures", "xiachufang-107357520.html");
  if (!fs.existsSync(xcfFixture)) {
    console.log("\n[2] 下厨房：快照缺失，跳过（存回 test/fixtures/xiachufang-107357520.html 即恢复）");
  } else {
    await runXcf();
  }
} catch (e) {
  console.error("✗ " + String((e && e.message) || e).split("\n")[0]);
  fails.push("异常中断");
} finally {
  await browser.close();
}

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
