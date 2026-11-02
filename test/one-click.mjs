/* 四站统一：点胶囊＝一键下载（正文，不带回复）
 *
 * 之前只有小红书点一下就存，另外三个站是「点一下开合面板」——而且开合规则还不一样：
 *   Chiphell    第一次点击只是把面板钉住（没视觉反应），第二次才收起
 *   少数派/值得买 悬停已经把面板打开了，点击的 toggle 直接把它关上
 * 现在统一：悬停展开面板选参数，点胶囊按当前选择直接存。
 *
 * 三个站分别验：
 *   Chiphell  最小页面，只验「点击确实进了 run()」——假页面没有帖子内容，
 *             run() 必然报错，报错本身就是证据
 *   少数派    真实快照，点胶囊要真的发出 downloadFiles，且 md 不含评论区
 *   什么值得买 真实快照，点胶囊要发出 downloadFiles
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/* chrome 打桩：只留 content script 用到的那几个口子 */
const stubChrome = () => {
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
    storage: {
      local: {
        get: (key, cb) => cb({}),
        set: () => {},
      },
    },
  };
  window.filesize = { filesize: (n) => Math.round(n / 1024) + " KB" };
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});

/* ---------- ① Chiphell：点击接进 run() ---------- */
{
  const CHH = `<!doctype html><meta charset="utf-8">
<div id="hd" style="height:60px">页头</div>
<div id="pt"><a href="/">论坛</a></div>
<div id="postlist"></div>`;
  const p = await browser.newPage();
  await p.route("https://www.chiphell.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: CHH })
  );
  await p.addInitScript(stubChrome);
  await p.goto("https://www.chiphell.com/thread-2600000-1-1.html", { waitUntil: "domcontentloaded" });
  await p.addScriptTag({ content: read("js/rn-format.js") });
  await p.addScriptTag({ content: read("content/chiphell.js") });
  await p.waitForSelector(".xhx-chh-btn", { timeout: 5000 });

  await p.hover(".xhx-chh-btn");
  await p.waitForFunction(() => !document.querySelector(".xhx-chh-panel").hidden, null, { timeout: 5000 });
  ok(true, "Chiphell：悬停展开面板");

  await p.click(".xhx-chh-btn");
  await p.waitForFunction(() => document.querySelector(".xhx-chh-status").textContent.trim() !== "", null, {
    timeout: 8000,
  });
  const st = (await p.locator(".xhx-chh-status").textContent()).trim();
  ok(/已提交|保存失败/.test(st), `Chiphell：点胶囊直接进 run()（状态「${st}」）`);
  ok(
    await p.evaluate(() => document.querySelector(".xhx-chh-panel").hidden),
    "Chiphell：点击后面板收起，不是「钉住等第二下」"
  );
  await p.close();
}

/* ---------- ② 少数派：点胶囊 = 存正文 ---------- */
{
  const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "sspai-117510.html"), "utf8");
  const p = await browser.newPage();
  await p.route("https://cdnfile.sspai.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG })
  );
  await p.route("https://cdn-static.sspai.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG })
  );
  await p.route("https://sspai.com/**", (r) =>
    r.request().resourceType() === "document"
      ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE })
      : r.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  await p.route("https://sspai.com/_nuxt/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "" })
  );
  await p.addInitScript(stubChrome);
  await p.goto("https://sspai.com/post/117510", { waitUntil: "domcontentloaded" });
  await p.addScriptTag({ content: read("js/rn-format.js") });
  await p.addScriptTag({ content: read("content/sspai.js") });
  await p.waitForSelector(".sspai-xhx-slot", { timeout: 5000 });

  await p.hover(".sspai-xhx-slot");
  await p.waitForFunction(() => document.querySelector(".sspai-xhx-qhead .cnt")?.textContent, null, {
    timeout: 5000,
  });
  ok(await p.evaluate(() => document.querySelector(".sspai-xhx-slot").classList.contains("is-open")),
    "少数派：悬停展开面板");

  await p.click(".sspai-xhx-entry");
  await p.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, {
    timeout: 10000,
  });
  const r = await p.evaluate(() => {
    const md = window.__sent.find((m) => m.type === "downloadFiles" && m.data.files[0].text);
    const imgs = window.__sent
      .filter((m) => m.type === "downloadFiles")
      .flatMap((m) => m.data.files)
      .filter((f) => f.url);
    return { md: md ? md.data.files[0].text : "", imgCount: imgs.length };
  });
  ok(r.imgCount > 0, `少数派：点胶囊直接开始存图（${r.imgCount} 张）`);
  ok(!!r.md && !r.md.includes("## 评论"), "少数派：一键下载走的是「正文」，md 不含评论区");
  // 收起是 setTimeout(…, 900) 里做的，等它落地
  await p.waitForFunction(() => !document.querySelector(".sspai-xhx-slot").classList.contains("is-open"), null, {
    timeout: 5000,
  });
  ok(true, "少数派：下载后面板收起");
  await p.close();
}

/* ---------- ③ 什么值得买：点胶囊 = 存正文 ---------- */
{
  const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "smzdm-a4qpgkgx.html"), "utf8");
  const p = await browser.newPage();
  await p.route("https://post.smzdm.com/p/a4qpgkgx/**", (r) =>
    r.request().resourceType() === "document"
      ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE })
      : r.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  await p.route("https://am.zdmimg.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/jpeg", body: PNG })
  );
  await p.addInitScript(stubChrome);
  await p.goto("https://post.smzdm.com/p/a4qpgkgx/", { waitUntil: "domcontentloaded" });
  await p.addScriptTag({ content: read("js/rn-format.js") });
  await p.addScriptTag({ content: read("content/smzdm.js") });
  await p.waitForSelector(".xhx-zdm-slot", { timeout: 5000 });

  await p.hover(".xhx-zdm-slot");
  await p.waitForFunction(() => document.querySelector(".xhx-zdm-qhead .cnt")?.textContent, null, {
    timeout: 5000,
  });
  ok(await p.evaluate(() => document.querySelector(".xhx-zdm-slot").classList.contains("is-open")),
    "值得买：悬停展开面板");

  await p.click(".xhx-zdm-entry");
  await p.waitForFunction(() => window.__sent.some((m) => m.type === "downloadFiles"), null, {
    timeout: 10000,
  });
  const n = await p.evaluate(
    () =>
      window.__sent
        .filter((m) => m.type === "downloadFiles")
        .flatMap((m) => m.data.files)
        .filter((f) => f.url).length
  );
  ok(n > 0, `值得买：点胶囊直接开始存图（${n} 张）`);
  await p.close();
}

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
