/* 豆瓣小组话题（/group/topic/<id>/）离线用例
 *
 *   PW=… PW_EXE=… node test/douban-topic.mjs
 *
 * 为什么要离线跑：小组/社区侧对自动化访问单独下了拦截（2026-11 复测：www 回 403
 * 「没有访问权限」、m.douban.com 回 404；同一时刻 movie.douban.com/review/ 仍能打开），
 * 真实话题页的结构无法当场核对。所以这里用 page.route 喂自造 HTML——
 * **它证明的是「候选选择器至少有一条能命中这套建模结构」，不证明真实页面就是这几个类名**。
 * 真实结构的兜底靠的是多候选 + 认不出时显示「未识别」，不是靠这个用例。
 *
 * 守七件事：
 *   ① 路径守卫放宽后，小组话题页出现胶囊，且图片计数正确（2 张）
 *   ② md 装配：来源/作者/tags 正确、引用数 == 下发媒体数、媒体都是 data:image/、
 *      正文里不含页面下方的回复（.comment-item 里的标记串）
 *   ③ 正文容器认不出时：按钮显示「未识别」，且**一个 downloadFiles 都不发**
 *      （不能把「没抓到」写成只有 frontmatter 的空 md）
 *   ④ 小组首页（/group/<id>/）不注入胶囊
 *   ⑤ 顶层 /topic/<id>/ 也注入，且 frontmatter 的链接保留 /topic/ 形态
 *   ⑥ 标题与正文都取不到 → 「未识别」+ 零下发（旧实现在这里静默 return）
 *   ⑦ 装配期抛异常 → 「失败」且文案停留 ≥1.2s（旧实现只停 900ms，等于没显示）
 *
 * 真实页面模板（个人动态页 / 视频菜谱）由 test/real-fixtures.mjs 用快照守，
 * 这个文件只证明候选选择器对建模结构成立。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

/* 别退回裸 "playwright"：ESM 不认 NODE_PATH，装不上就 ERR_MODULE_NOT_FOUND。
 * 默认给托管 node 的共享 workspace，PW 环境变量仍可覆盖（同 e2e-discuz-blocked.mjs）。 */
const PW_DEFAULT = "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(path.resolve(process.env.PW || PW_DEFAULT)).href);
const { chromium } = pw.default ?? pw;

const EXT = process.env.EXT_DIR || path.resolve(".");
/* 不传 executablePath 时 playwright 会去找 headless shell（本机只装了 chromium-1243）。 */
const BROWSER =
  process.env.PW_EXE || "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";

const TOPIC_URL = "https://www.douban.com/group/topic/502472541/";
/* 豆瓣把话题页扩到了顶层 /topic/<id>/，模板与小组内那套一致，只是地址短了。 */
const TOPIC_TOP_URL = "https://www.douban.com/topic/502558660/";
const GROUP_URL = "https://www.douban.com/group/220619/";

const TITLE = "小组话题离线用例标题";
const GROUP = "测试小组";
const AUTHOR = "测试作者";
const IMG1 = "https://img9.doubanio.com/view/group_topic/l/public/p1234567.jpg";
const IMG2 = "https://img9.doubanio.com/view/group_topic/l/public/p1234568.jpg";
const REPLY = "__REPLY_SHOULD_NOT_APPEAR__";

/* 按 content/douban.js 里的候选结构建模：
 *   #content h1        —— 标题首选
 *   .topic-doc h3      —— 组名（/group/）+ 作者（/people/）+ .create-time
 *   .topic-richtext    —— 正文首选容器，2 段 <p> + 2 个 .image-container
 *   .comment-item      —— 正文容器**之外**的回复，用来验证回复不会被带进 md
 * bodyClass 可换掉正文容器的类名，模拟「候选全不中」。
 */
const buildTopic = (bodyClass = "topic-richtext") => `<!doctype html><html><head><meta charset="utf-8">
<title>${TITLE}</title></head><body>
<div id="content">
  <h1>${TITLE}</h1>
  <div class="topic-doc">
    <h3>
      <a href="https://www.douban.com/group/220619/">${GROUP}</a>
      <a href="https://www.douban.com/people/1234567/">${AUTHOR}</a>
      <span class="create-time">2024-11-05 21:33:07</span>
    </h3>
    <div class="${bodyClass}">
      <p>第一段正文，用来证明正文容器被认出来了。</p>
      <div class="image-container"><img src="${IMG1}" alt="图一"></div>
      <p>第二段正文，排在两张图之间。</p>
      <div class="image-container"><img src="${IMG2}" alt="图二"></div>
    </div>
  </div>
  <div class="comment-item">
    <p>${REPLY}</p>
  </div>
</div>
</body></html>`;

const buildGroupHome = () => `<!doctype html><html><head><meta charset="utf-8">
<title>${GROUP}</title></head><body>
<div id="content">
  <h1>${GROUP}</h1>
  <div class="topic-list"><a href="/group/topic/502472541/">某个话题</a></div>
</div>
</body></html>`;

const fails = [];
const check = (name, cond) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name);
  if (!cond) fails.push(name);
};

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

/* 每个用例一个新 page：__SENT 要干净，路由也要各不相同。 */
async function openPage(url, html) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__SENT = [];
    /* 1x1 JPEG，只是让 fetchMedia 有个像样的返回；字节内容不参与断言。 */
    window.__FAKE_JPEG =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
    window.chrome = {
      runtime: {
        getURL: (p) => location.origin + "/" + p,
        sendMessage: async (msg) => {
          /* 离线用例不碰 doubanio：真实取字节（Referer/418）由 e2e-real-douban.mjs 守。
           * 这里只验「拿到字节 → data: URL → md 引用」这条装配链。 */
          if (msg && msg.type === "fetchMedia") {
            return { ok: true, type: "image/jpeg", base64: window.__FAKE_JPEG };
          }
          window.__SENT.push(msg);
          return { done: (msg.data.files || []).length, failed: [], cancelled: false };
        },
      },
      storage: { local: { get: (_k, cb) => cb({}), set: () => {} } },
    };
  });

  /* 先注册全拦，再注册目标页（Playwright 后注册的先匹配）。
   * 全拦是为了让用例完全不依赖外网——豆瓣现在 403，图床也未必连得上。 */
  await page.route("**/*", (route) => route.abort());
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.addStyleTag({ path: path.join(EXT, "content/douban.css") });
  await page.addScriptTag({ path: path.join(EXT, "js/rn-format.js") });
  await page.addScriptTag({ path: path.join(EXT, "content/douban.js") });
  return page;
}

const sentOf = (page) => page.evaluate(() => window.__SENT);
const mdSent = (page) =>
  page.waitForFunction(
    () =>
      window.__SENT.some(
        (m) => m.type === "downloadFiles" && (m.data.files || []).some((f) => f.mime === "text/markdown")
      ),
    null,
    { timeout: 20000 }
  );

try {
  /* ---------- 正向：小组话题页 ---------- */
  const page = await openPage(TOPIC_URL, buildTopic());

  console.log("\n[1] 小组话题页：胶囊出现，图片计数正确");
  await page.waitForSelector(".db-xhx-entry", { timeout: 10000 });
  check("路径守卫放宽后 .db-xhx-entry 出现", true);
  await page.hover(".db-xhx-slot");
  await page.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  const cnt = (await page.textContent(".db-xhx-panel .cnt")) || "";
  check(`面板计数为「2 张」（实际「${cnt}」）`, cnt.trim() === "2 张");

  console.log("\n[2] 保存后的 md 装配");
  await page.click(".db-xhx-act");
  await mdSent(page);
  const batches = (await sentOf(page)).filter((m) => m.type === "downloadFiles");
  const files = batches.flatMap((m) => m.data.files || []);
  const md = files.find((f) => f.mime === "text/markdown");
  const media = files.filter((f) => f.url);
  if (!md) throw new Error("没有产出 markdown");
  const text = md.text;

  check("frontmatter 有「来源: 豆瓣」", /^来源: 豆瓣$/m.test(text));
  /* 只认 /people/ 锚点：h3 里排在前面的组名若被当成作者，这里会变成「测试小组」或两者拼起来。 */
  check(`作者取自 /people/ 锚点（实际「${(/^作者: (.*)$/m.exec(text) || [])[1]}」）`, /^作者: 测试作者$/m.test(text));
  check("tags 含小组名", /^\s+- "测试小组"$/m.test(text));
  check("正文取到了", text.includes("第一段正文") && text.includes("第二段正文"));
  /* 胶囊是挂进 <h1> 的子节点。读 h1.textContent 会把面板文案（剪藏/下载/跳过/保存/N 张）
   * 一起读进标题，而标题又要进目录名和文件名——这条就是那个坑的护栏。 */
  check(`H1 标题没被胶囊文案污染（实际「${(/^# (.*)$/m.exec(text) || [])[1]}」）`,
    /^# 小组话题离线用例标题$/m.test(text));
  check(`目录名/文件名只由 日期+标题+作者 组成（实际「${md.filename}」）`,
    md.filename === "小组话题离线用例标题/2024.11.05_小组话题离线用例标题_测试作者.md");
  check(`时间用话题页的 create-time（2024.11.05，文件名「${md.filename}」）`, /^时间: 2024-11-05_/m.test(text));

  const refs = [...text.matchAll(/!\[(\d+)\]\(/g)];
  check(`md 引用数 ${refs.length} == 下发媒体数 ${media.length}`, refs.length === media.length && media.length === 2);
  check(
    `每个媒体 url 都是 data:image/（共 ${media.length} 个）`,
    media.length > 0 && media.every((f) => String(f.url).startsWith("data:image/"))
  );
  check("正文里没有 .comment-item 的回复标记", !text.includes(REPLY));

  /* ---------- 反向 A：正文容器候选全不中 ---------- */
  console.log("\n[3] 反向：正文容器换成 xxx-unknown → 未识别，且零下发");
  const bad = await openPage(TOPIC_URL, buildTopic("xxx-unknown"));
  await bad.waitForSelector(".db-xhx-entry", { timeout: 10000 });
  await bad.hover(".db-xhx-slot");
  await bad.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  await bad.click(".db-xhx-act");
  await bad
    .waitForFunction(
      () => (document.querySelector(".db-xhx-act") || {}).textContent === "未识别",
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  const actual = (await bad.textContent(".db-xhx-act")) || "";
  check(`按钮文案变成「未识别」（实际「${actual.trim()}」）`, actual.trim() === "未识别");
  /* 等一会儿再查：万一实现是先发 md 再改文案，这里就能抓到。 */
  await bad.waitForTimeout(600);
  const badSent = await sentOf(bad);
  check(`没有发出任何 downloadFiles（实际 ${badSent.filter((m) => m.type === "downloadFiles").length} 条）`,
    badSent.filter((m) => m.type === "downloadFiles").length === 0);
  check(`也没有发出 fetchMedia（实际 ${badSent.filter((m) => m.type === "fetchMedia").length} 条）`,
    badSent.filter((m) => m.type === "fetchMedia").length === 0);
  await bad.close();

  /* ---------- 反向 B：小组首页不注入 ---------- */
  console.log("\n[4] 反向：小组首页（/group/220619/）不注入胶囊");
  const home = await openPage(GROUP_URL, buildGroupHome());
  await home.waitForTimeout(1200); // 跨过一次 1.5s 的 tick 与 MutationObserver
  const n = await home.evaluate(() => document.querySelectorAll(".db-xhx-entry").length);
  check(`首页胶囊数量为 0（实际 ${n}）`, n === 0);

  /* ---------- 顶层 /topic/<id>/（豆瓣把话题页从小组内扩到了顶层） ----------
   * 这条是「路径变了没人测」漏掉的回归：模板没变，只是地址换了，
   * 所以 DOM 直接复用 buildTopic()，只换 URL。 */
  console.log("\n[5] 顶层话题页 /topic/<id>/");
  const top = await openPage(TOPIC_TOP_URL, buildTopic());
  await top.waitForSelector(".db-xhx-entry", { timeout: 10000 });
  check("/topic/<id>/ 也能注入胶囊", true);
  await top.hover(".db-xhx-slot");
  await top.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  await top.click(".db-xhx-act");
  await mdSent(top);
  const topFiles = (await sentOf(top)).filter((m) => m.type === "downloadFiles").flatMap((m) => m.data.files || []);
  const topMd = topFiles.find((f) => f.mime === "text/markdown");
  if (!topMd) throw new Error("/topic/ 页没有产出 markdown");
  check("md 能装配出正文与图片", topMd.text.includes("第一段正文") && /!\[1\]\(/.test(topMd.text));
  /* frontmatter 的链接必须是用户实际打开的那条，不能一律写成 /group/topic/。 */
  check(
    `链接保留 /topic/ 形态（实际「${(/^链接: (.*)$/m.exec(topMd.text) || [])[1]}」）`,
    /^链接: https:\/\/www\.douban\.com\/topic\/502558660\/$/m.test(topMd.text)
  );
  check(`文件名正常（实际「${topMd.filename}」）`, /小组话题离线用例标题/.test(topMd.filename) && !/剪藏/.test(topMd.filename));
  await top.close();

  /* ---------- 反向 C：标题与正文都取不到 ----------
   * 2026-11 起「没有 h1」不再等于失败：动态页的 h1.topic-title 是空壳，
   * 标题由正文首句兜底（见 [8]）。所以这条反向必须把**正文容器也打掉**，
   * 才是真正的「这页不是正文页」。 */
  console.log("\n[6] 反向：无标题 + 正文容器认不出 → 未识别，且零下发");
  const noTitle = await openPage(
    TOPIC_TOP_URL,
    buildTopic("xxx-unknown").replace(`<h1>${TITLE}</h1>`, "") + '<div class="main-hd"></div>'
  );
  await noTitle.waitForSelector(".db-xhx-entry", { timeout: 10000 });
  await noTitle.hover(".db-xhx-slot");
  await noTitle.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  await noTitle.click(".db-xhx-act");
  await noTitle
    .waitForFunction(() => (document.querySelector(".db-xhx-act") || {}).textContent === "未识别", null, { timeout: 5000 })
    .catch(() => {});
  const ntText = ((await noTitle.textContent(".db-xhx-act")) || "").trim();
  check(`按钮文案变成「未识别」（实际「${ntText}」）`, ntText === "未识别");
  const ntSent = await sentOf(noTitle);
  check(`零下发 downloadFiles（实际 ${ntSent.filter((m) => m.type === "downloadFiles").length} 条）`,
    ntSent.filter((m) => m.type === "downloadFiles").length === 0);
  await noTitle.close();

  /* ---------- 反向 D：装配期抛异常 ----------
   * 点击后任何一步抛错，都必须变成看得见的「失败」，而且停够时间。
   * 旧实现把 readInfo/deliver 裸放在 async 回调里，异常 = 未捕获的 rejection，
   * 界面一个字都不变，跟「没点到」完全无法区分。 */
  console.log("\n[7] 反向：装配抛异常 → 失败，且文案停留够久");
  const boom = await openPage(TOPIC_URL, buildTopic());
  await boom.waitForSelector(".db-xhx-entry", { timeout: 10000 });
  await boom.evaluate(() => {
    window.__RN.markdown = () => {
      throw new Error("boom");
    };
  });
  await boom.hover(".db-xhx-slot");
  await boom.waitForSelector(".db-xhx-panel", { state: "visible", timeout: 5000 });
  await boom.click(".db-xhx-act");
  await boom
    .waitForFunction(() => (document.querySelector(".db-xhx-act") || {}).textContent === "失败", null, { timeout: 5000 })
    .catch(() => {});
  const boomText = ((await boom.textContent(".db-xhx-act")) || "").trim();
  check(`按钮文案变成「失败」（实际「${boomText}」）`, boomText === "失败");
  /* 900ms 的停留肉眼抓不住，等于又变回「没反应」；确认至少 1.2s 还在。 */
  await boom.waitForTimeout(1200);
  const boomLater = ((await boom.textContent(".db-xhx-act")) || "").trim();
  check(`1.2s 后仍显示「失败」（实际「${boomLater}」）`, boomLater === "失败");
  await boom.close();

  await page.close();
  await home.close();
} catch (e) {
  console.error("✗ " + String((e && e.message) || e).split("\n")[0]);
  fails.push("异常中断");
} finally {
  await browser.close();
}

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
