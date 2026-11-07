/* 小红书：保存链路抛错时必须留话，取消时必须闭嘴
 *
 * 这是「失败被当成成功」在小红书侧的最后一个洞：`catch` 以前一律吞掉，于是
 *   · 扩展刚重载（端口失效）
 *   · 后台回 error（笔记没取到 / 被风控）
 *   · 页面结构变了导致中途抛异常
 * 全都表现为「按钮转一圈又变回『剪藏』」——跟存好了长得一模一样。
 * 而用户主动按的取消必须是静默的，不能反过来误报失败。
 *
 * 判据只有一条：cancelled 置位时闭嘴，其余一律把胶囊文字换成「失败」并 4s 后还原。
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

/* mode:
 *   "reject"  saveData 直接 reject —— 模拟后台回 error / 端口失效
 *   "defer"   saveData 挂起，等测试主动 reject —— 用来模拟「先取消、后抛错」 */
const page = (mode) => `<!doctype html><meta charset="utf-8">
<style>${read("content/index.css")}</style>
<script>
  window.__MODE__ = ${JSON.stringify(mode)};
  window.__sent = [];
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: (msg) => {
        window.__sent.push(msg.type);
        if (msg.type === "saveData") {
          if (window.__MODE__ === "reject") return Promise.reject(new Error("note not captured"));
          return new Promise((resolve, reject) => { window.__pending = { resolve, reject }; });
        }
        if (msg.type === "download") return Promise.resolve({ done: 1, failed: [] });
        return Promise.resolve({});
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

async function open(mode) {
  const p = await browser.newPage();
  await p.route("https://www.xiaohongshu.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page(mode) })
  );
  await p.goto("https://www.xiaohongshu.com/explore/abc123", { waitUntil: "load" });
  await p.waitForSelector(".xhx-download-container", { state: "attached", timeout: 5000 });
  return p;
}

const brand = (p) => p.evaluate(() => document.querySelector(".xhx-brand-text").textContent);
const clickCapsule = (p) => p.evaluate(() => document.querySelector(".xhx-download-container").click());

/* ① 后台回 error：必须显示「失败」，且 md 一张都不该发 */
console.log("\n[1] saveData reject（后台回 error / 端口失效）");
{
  const p = await open("reject");
  await clickCapsule(p);
  await p.waitForFunction(() => document.querySelector(".xhx-brand-text").textContent === "失败", null, {
    timeout: 5000,
  }).catch(() => {});
  ok((await brand(p)) === "失败", `胶囊显示「失败」（实际「${await brand(p)}」）`);
  const sent = await p.evaluate(() => window.__sent.slice());
  ok(!sent.includes("download"), `没进入下载阶段，md 不会被误发（实际发了 ${sent.join(",")}）`);
  /* 4s 后必须还原，不能把「失败」永久糊在胶囊上 */
  await p.waitForTimeout(4300);
  ok((await brand(p)) === "剪藏", `4s 后还原为「剪藏」（实际「${await brand(p)}」）`);
  await p.close();
}

/* ② 用户取消后链路才抛错：必须闭嘴，不能误报失败 */
console.log("\n[2] 取消后抛错（用户主动按的取消）");
{
  const p = await open("defer");
  await clickCapsule(p);
  /* 等 saveData 真的挂起，再点第二下取消（400ms 防误判双击的窗口要躲开） */
  await p.waitForFunction(() => !!window.__pending, null, { timeout: 5000 });
  await p.waitForTimeout(450);
  await clickCapsule(p);
  const sent = await p.evaluate(() => window.__sent.slice());
  ok(sent.includes("cancel"), `第二下点击发出了 cancel（实际 ${sent.join(",")}）`);
  /* 取消之后再把挂起的 promise 拒掉，模拟后台真正收尾 */
  await p.evaluate(() => window.__pending.reject(new Error("cancel by user")));
  await p.waitForTimeout(300);
  ok((await brand(p)) === "剪藏", `取消不误报，胶囊仍是「剪藏」（实际「${await brand(p)}」）`);
  await p.close();
}

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项失败` : "\n✓ 全部通过");
process.exit(fails.length ? 1 : 0);
