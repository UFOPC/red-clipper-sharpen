/* 视频缺省档（端到端）：真跑 content/index.js，看面板里点亮的是哪一档
 *
 * 单元测试只能证明 pickDefaultQuality 算得对，证不了「面板确实用了它、也确实把 URL
 * 交给了后台」。所以这里在真路径 /explore/xxx 上注入真脚本，只把 chrome / filesize 打桩，
 * 然后 mouseenter 触发展开，读 DOM。
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

const STREAM = {
  h264: [
    { masterUrl: "https://cdn.test/720.mp4", width: 720, height: 960, avgBitrate: 900 },
    { masterUrl: "https://cdn.test/1440.mp4", width: 1440, height: 1920, avgBitrate: 6000 },
    { masterUrl: "https://cdn.test/1080.mp4", width: 1080, height: 1920, avgBitrate: 3000 },
  ],
};

const page = (stream, kind) => `<!doctype html><meta charset="utf-8">
<style>${read("content/index.css")}</style>
<script>
  window.__STREAM__ = ${JSON.stringify(stream)};
  window.__KIND__ = ${JSON.stringify(kind || (stream ? "video" : "normal"))};
  window.__sent = [];
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: (msg) => {
        window.__sent.push(msg);
        return Promise.resolve(
          msg && msg.type === "getNote"
            ? Object.assign(
                { type: window.__KIND__ },
                window.__STREAM__ ? { video: { media: { stream: window.__STREAM__ } } } : {}
              )
            : {}
        );
      },
    },
  };
  window.filesize = { filesize: (n) => Math.round(n / 1024) + " KB" };
</script>
<div class="note-container">
  <div class="interaction-container"><div class="author-wrapper"><span class="name">作者</span></div></div>
  <div class="media-container"></div>
</div>
<script>${read("js/rn-format.js")}</script>
<script>${read("content/index.js")}</script>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});

async function open(stream, ready, kind) {
  const p = await browser.newPage();
  await p.route("https://www.xiaohongshu.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page(stream, kind) })
  );
  await p.goto("https://www.xiaohongshu.com/explore/abc123", { waitUntil: "load" });
  // 胶囊默认 display:none，要等页面自己 a(1,…) 才显示；这里只关心逻辑，attached 即可
  await p.waitForSelector(".xhx-download-container", { state: "attached", timeout: 5000 });
  await p.$eval(".xhx-download-container", (el) => el.dispatchEvent(new MouseEvent("mouseenter")));
  // 档位填充是异步的（要先问后台拿 note），按各自的结果条件等，别一律等 .xhx-opt
  await p.waitForFunction(ready || (() => document.querySelectorAll(".xhx-opt").length > 0), null, {
    timeout: 5000,
  });
  return p;
}

/* ① 有 1440 / 1080 / 720 三档：点亮 1080，URL 交给 1080 */
{
  const p = await open(STREAM);
  const r = await p.evaluate(() => ({
    opts: [...document.querySelectorAll(".xhx-opt")].map((x) => ({
      res: x.querySelector(".res").textContent,
      on: x.classList.contains("is-on"),
    })),
    url: document.querySelector(".xhx-download-container").dataset.videoUrl,
    state: document.querySelector(".xhx-state"),
  }));
  ok(r.opts.map((o) => o.res).join(" ") === "1440×1920 1080×1920 720×960", `档位按像素降序：${r.opts.map((o) => o.res).join(" ")}`);
  ok(r.opts.filter((o) => o.on).length === 1, "只点亮一档");
  ok(r.opts[1].on, `缺省点亮 1080×1920（实际 ${r.opts.find((o) => o.on)?.res}）`);
  ok(r.url === "https://cdn.test/1080.mp4", `缺省档 URL 已交给下载（${r.url || "空"}）`);
  ok(r.state === null, "面板头不再写「N 档可选」——档位就列在下面");

  // 手动改选 720 后，URL 跟着换
  await p.evaluate(() => document.querySelectorAll(".xhx-opt")[2].click());
  const after = await p.evaluate(() => document.querySelector(".xhx-download-container").dataset.videoUrl);
  ok(after === "https://cdn.test/720.mp4", `改选 720 后 URL 跟上（${after}）`);
  await p.close();
}

/* ② 只有 1440 与 720：没有 1080，退 720，不能退回 1440 */
{
  const p = await open({ h264: [STREAM.h264[1], STREAM.h264[0]] });
  const r = await p.evaluate(() => ({
    on: document.querySelector(".xhx-opt.is-on .res").textContent,
    url: document.querySelector(".xhx-download-container").dataset.videoUrl,
  }));
  ok(r.on === "720×960", `没有 ≤1080P 的更高档时退 720（${r.on}）`);
  ok(r.url === "https://cdn.test/720.mp4", `URL 同步（${r.url}）`);
  await p.close();
}

/* ③ 只有一档：照样画一行。以前直接不画，面板跟图文贴长得一模一样，
 * 用户以为「没识别到视频」。一行也画，至少能看出这是视频贴着。 */
{
  const p = await open({ h264: [STREAM.h264[2]] });
  const r = await p.evaluate(() => ({
    hidden: document.querySelector(".xhx-quality").hidden,
    rows: [...document.querySelectorAll(".xhx-opt")].map((x) => x.querySelector(".res").textContent),
    on: document.querySelector(".xhx-opt.is-on .res").textContent,
    state: document.querySelector(".xhx-state"),
    url: document.querySelector(".xhx-download-container").dataset.videoUrl,
    divider: getComputedStyle(document.querySelector(".xhx-divider")).display,
  }));
  ok(r.hidden === false, "单一档位也展开清晰度区");
  ok(r.rows.join() === "1080×1920", `只有一行（${r.rows.join()}）`);
  ok(r.on === "1080×1920", `唯一那档点亮（${r.on}）`);
  ok(r.state === null, "单一档位也不写任何说明文案");
  ok(r.divider !== "none", "有档位时保留上方分隔线");
  ok(!r.url, "单一档位不写 URL，交给后台");
  await p.close();
}

/* ③' 视频贴但一档都摊不出来：仍然显示「原始画质」，别让人以为没认出来 */
{
  const p = await open(null, () => document.querySelector(".xhx-quality").hidden === false, "video");
  const r = await p.evaluate(() => ({
    hidden: document.querySelector(".xhx-quality").hidden,
    rows: [...document.querySelectorAll(".xhx-opt")].map((x) => x.querySelector(".res").textContent),
    photo: document.querySelector(".xhx-download-more").classList.contains("is-photo"),
    url: document.querySelector(".xhx-download-container").dataset.videoUrl,
  }));
  ok(r.hidden === false, "取不到档位也展开清晰度区");
  ok(r.rows.join() === "原始画质", `写「原始画质」（${r.rows.join()}）`);
  ok(r.photo === false, "不能退化成图文面板");
  ok(!r.url, "不指定档位，后台自己挑最高档");
  await p.close();
}

/* ④ 图文：连清晰度区都没有 */
{
  const p = await open(null, () => document.querySelector(".xhx-download-more").classList.contains("is-photo"));
  const r = await p.evaluate(() => {
    const row = document.querySelector(".xhx-photo-row");
    return {
      photo: document.querySelector(".xhx-download-more").classList.contains("is-photo"),
      hidden: document.querySelector(".xhx-quality").hidden,
      rowShown: !row.hidden && getComputedStyle(row).display !== "none",
      cnt: row.querySelector(".cnt").textContent,
      on: [...row.querySelectorAll("button")].filter((b) => b.classList.contains("is-on")).map((b) => b.textContent),
      media: document.querySelector(".xhx-download-container").dataset.media,
    };
  });
  ok(r.photo && r.hidden, "图文笔记标记 is-photo 且隐藏清晰度区");
  ok(r.rowShown, "图文贴展开「图片 N 张」行");
  ok(r.cnt === "无", `没有 imageList 时写「无」（实际「${r.cnt}」）`);
  ok(r.on.join() === "下载" && r.media === "1", `缺省选「下载」（点亮「${r.on.join()}」，media=${r.media}）`);
  await p.close();
}

/* ⑤ 双击只算一次：第二下不能正好把自己取消掉 */
{
  const p = await open({ h264: [STREAM.h264[1], STREAM.h264[0]] }, () => true);
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const el = document.querySelector(".xhx-download-container");
    // 两次点击在同一帧里发出，模拟双击
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({
    save: window.__sent.filter((m) => m.type === "saveData").length,
    cancel: window.__sent.filter((m) => m.type === "cancel").length,
  }));
  ok(r.save === 1, `双击只发一次 saveData（实际 ${r.save} 次）`);
  ok(r.cancel === 0, `双击不会触发取消（实际 ${r.cancel} 次）`);
  await p.close();
}

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
