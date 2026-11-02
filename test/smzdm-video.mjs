/* 什么值得买：视频（站内嵌卡片）必须能存下来
 *
 * 视频卡在静态 HTML 里只有 video-id 和 video-cover，播放器由 JS 注入：
 *   <dir class="insert-video-card insert-video" video-id="…">
 *     <div><video class="haowen-video"><source src="https://sqcwsp-vod.smzdm.com/…/v.f100030.mp4?t=…&sign=…"></video></div>
 *   </dir>
 * 地址是签名过的，改写尾部指令（_e1080/_fo710）会直接把它弄坏，所以只能原样下。
 *
 * 这个用例守四件事：
 *   ① 视频进 media 清单，且位置就在正文里它出现的地方
 *   ② 视频先在本页 fetch（带 Referer）拿字节，下载器收到的是 data: URL
 *      —— 这里把 CDN 做成「没 Referer 就 403」，正是线上「没有权限，无法下载」的成因
 *   ③ 签名参数原样保留，不能被任何改写碰到
 *   ④ md 里视频走图片语法 ![](./<stem>-N.mp4)，Obsidian 按扩展名渲染成播放器
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(EXT, p), "utf8");

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

const VIDEO_URL =
  "https://sqcwsp-vod.smzdm.com/a28897e2vodtranssh1500013160/90f408825001834826092657263/v.f100030.mp4?t=6aea3812&exper=0&us=1185488174&sign=11450ae43a9e13ccd7b5e6103683ab00";
const IMG_URL = "https://am.zdmimg.com/202611/02/6ae86498d58202213.png_e1080.jpg";

const PAGE = `<!doctype html><meta charset="utf-8">
<title>视频贴测试_什么值得买</title>
<meta property="article:author" content="测试作者">
<meta property="article:published_time" content="2026-11-02T10:30:00+08:00">
<article id="articleId">
  <h1 class="item-name">视频贴测试</h1>
  <div class="txt-detail">
    <p>第一段正文。</p>
    <p><img src="${IMG_URL}" alt="图一"></p>
    <dir data-status="1" video-id="5001834826092657263" video-cover="${IMG_URL}"
         video-des="看好配料表！" video-title="视频_1 (5).mp4" contenteditable="false"
         class="insert-video-card insert-video">
      <div><video class="haowen-video" width="100%" height="360" controls>
        <source src="${VIDEO_URL}" type="video/mp4">
      </video></div>
    </dir>
    <p>最后一段正文。</p>
  </div>
</article>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});

const p = await browser.newPage();
await p.route("https://post.smzdm.com/p/avp2r9o4/**", (r) =>
  r.request().resourceType() === "document"
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE })
    : r.fulfill({ status: 200, contentType: "image/jpeg", body: "" })
);

/* 视频 CDN：防盗链。没 Referer 直接 403（线上就是这个表现），带 Referer 才给字节。
 * ACAO 用 *，因为内容脚本用的是 credentials:"omit"。 */
const VIDEO_BODY = Buffer.from("MP4-DATA-OF-THE-CLIP");
const videoHits = [];
await p.route("https://sqcwsp-vod.smzdm.com/**", (r) => {
  const referer = r.request().headers()["referer"] || "";
  videoHits.push(referer ? "with-referer" : "no-referer");
  if (!referer) return r.fulfill({ status: 403, contentType: "text/plain", body: "forbidden" });
  return r.fulfill({
    status: 200,
    contentType: "video/mp4",
    headers: { "access-control-allow-origin": "*" },
    body: VIDEO_BODY,
  });
});
await p.addInitScript(() => {
  window.__sent = [];
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: (msg) => {
        window.__sent.push(msg);
        return Promise.resolve({});
      },
    },
    storage: { local: { get: (_k, cb) => cb && cb({}), set: () => {} } },
  };
});
await p.goto("https://post.smzdm.com/p/avp2r9o4/", { waitUntil: "domcontentloaded" });
await p.addScriptTag({ content: read("js/rn-format.js") });
await p.addScriptTag({ content: read("content/smzdm.js") });
await p.waitForSelector(".xhx-zdm-slot", { timeout: 5000 });

await p.hover(".xhx-zdm-slot");
await p.waitForFunction(() => document.querySelector(".xhx-zdm-qhead .cnt")?.textContent, null, {
  timeout: 5000,
});

console.log("\n[1] 面板把视频算进媒体数");
const label = await p.evaluate(() => ({
  lbl: document.querySelector(".xhx-zdm-qhead .lbl").textContent,
  cnt: document.querySelector(".xhx-zdm-qhead .cnt").textContent,
}));
ok(label.lbl === "图片+视频", `有视频时标签是「图片+视频」（实际「${label.lbl}」）`);
ok(label.cnt === "2 项", `1 图 + 1 视频 = 2 项（实际「${label.cnt}」）`);

console.log("\n[2] 点胶囊：视频与图片一起下发");
await p.click(".xhx-zdm-entry");
/* md 现在先发，媒体后发，所以要等 md 到了再等一会儿才收得全 */
await p
  .waitForFunction(
    () => window.__sent.some((m) => m.type === "downloadFiles" && (m.data.files || []).some((f) => f.mime === "text/markdown")),
    null,
    { timeout: 15000 }
  )
  .catch(() => {});
await p.waitForTimeout(800);
const files = await p.evaluate(() =>
  window.__sent
    .filter((m) => m.type === "downloadFiles")
    .flatMap((m) => m.data.files)
);
const media = files.filter((f) => f.url);
const mdFile = files.find((f) => f.mime === "text/markdown");
ok(media.length === 2, `下发了 2 个媒体（实际 ${media.length}）`);
const video = media.find((f) => /\.mp4$/.test(f.filename));
ok(!!video, "有一个 .mp4");
ok(
  video && video.url.startsWith("data:video/mp4;base64,"),
  `视频先抓字节，交给下载器的是 data: URL（${video ? video.url.slice(0, 32) : "缺"}…）`
);
ok(video && video.url.length > 0 && !video.url.includes("sqcwsp-vod"),
  "下载器拿不到裸视频地址（裸请求会被防盗链 403）");
ok(video && Buffer.from(video.url.split(",")[1], "base64").equals(VIDEO_BODY),
  "抓到的字节与 CDN 返回的一致");
/* <video> 自己会去预载一次，加上我们这次 fetch，正常是两次——两次都必须带 Referer，
 * 没有 Referer 的裸请求这里会拿到 403，也就抓不到字节了。 */
ok(
  videoHits.length >= 1 && videoHits.every((hit) => hit === "with-referer"),
  `请求 CDN 时都带着 Referer（实际 ${JSON.stringify(videoHits)}）`
);
ok(video && /-2\.mp4$/.test(video.filename), `视频排在图片之后，编号 2（${video && video.filename}）`);
const image = media.find((f) => !/\.mp4$/.test(f.filename));
ok(
  image && image.url.includes("_e1080.") && /-1\.png$/.test(image.filename),
  `图片仍走 1080 档、编号 1，扩展名取源扩展名 .png（${image && image.filename}）`
);

console.log("\n[3] Markdown 里视频用图片语法引用");
const md = mdFile ? mdFile.text : "";
ok(!md.includes("\u0000"), "占位符全部替换掉了");
const first = md.indexOf("](./");
const second = md.indexOf("](./", first + 1);
ok(/^\]\(\.\/[^)]*-1\.png\)$/.test(md.slice(first, md.indexOf(")", first) + 1)), `第一个引用是图片（${md.slice(first, md.indexOf(")", first) + 1)}）`);
ok(md.slice(second).startsWith("](./") && /\]\(\.\/[^)]*\.mp4\)/.test(md.slice(second, second + 200)),
  `第二个引用是视频（${md.slice(second, second + 60)}）`);
ok(md.includes("第一段正文") && md.includes("最后一段正文"), "视频卡前后的正文都在");
ok(!md.includes("视频卡片（"), "取到地址时不该留下「未取到播放地址」的提示");
ok(!md.includes("剪藏") && !md.includes("保存文章"), "插件自己的按钮与面板不能漏进正文");
ok(md.includes("\n类型: 图文+视频\n"), `夹带视频的帖子，类型写「图文+视频」（${(md.match(/^类型: .*$/m) || [""])[0]}）`);

console.log("\n[4] 视频抓不到时，md 仍然要落盘");
await p.waitForTimeout(1200);
await p.unroute("https://sqcwsp-vod.smzdm.com/**");
await p.route("https://sqcwsp-vod.smzdm.com/**", (r) =>
  r.fulfill({ status: 500, contentType: "text/plain", body: "boom" })
);
await p.evaluate(() => {
  window.__sent.length = 0;
});
await p.click(".xhx-zdm-entry");
await p
  .waitForFunction(
    () => window.__sent.some((m) => m.type === "downloadFiles" && (m.data.files || []).some((f) => f.mime === "text/markdown")),
    null,
    { timeout: 15000 }
  )
  .catch(() => {});
await p.waitForTimeout(800);
const afterFail = await p.evaluate(() => {
  const all = window.__sent.filter((m) => m.type === "downloadFiles").flatMap((m) => m.data.files);
  const md = all.find((f) => f.mime === "text/markdown");
  return { md: md ? md.text : "", media: all.filter((f) => f.url && !f.mime) };
});
ok(!!afterFail.md, "视频抓取失败，md 依然下发");
ok(afterFail.md.includes("视频未能取到字节") && afterFail.md.includes("HTTP 500"), "md 里写明失败原因（HTTP 500）");
ok(afterFail.media.length === 2, `媒体该下发 2 个（实际 ${afterFail.media.length}）`);
const fallbackVideo = afterFail.media.find((f) => /\.mp4$/.test(f.filename));
ok(fallbackVideo && fallbackVideo.url === VIDEO_URL, "视频退回原始签名地址，没有静默丢掉");

await p.close();
await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
