/* 小红书：胶囊与「关注」的间距必须是常量
 *
 * 实测症状：作者名长短一变，胶囊跟「关注」的距离就从 7px 跳到 50px。
 * 原因是作者行是 justify-content:space-between，我们插进去的胶囊算第三个 flex 项，
 * 剩余空间被两个间隙平分 —— 名短则间隙大，名长则间隙小。
 *
 * 修法不依赖站点用哪种排布：量出实际间距，用 margin-left 拉回固定值，迭代到收敛。
 * 这个用例守的就是「短名 / 长名 / 极长名 三种情况下间距都相同，且不顶出容器」。
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

const page = (name) => `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;font:14px/1.5 sans-serif;background:#fff}
  .note-container{width:600px;margin:80px 0 0 60px}
  /* 站点实际是 space-between：这就是间距会飘的根源 */
  .author-wrapper{display:flex;align-items:center;justify-content:space-between;width:430px}
  /* 名字不能 flex:1 —— 那样剩余空间被名字吃干，间距天然为 0，根本复现不了「忽远忽近」。
     真页面上名字是不伸缩的，剩余空间由 space-between 分给两个间隙。 */
  .name{flex:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .follow{flex:none;height:32px;padding:0 18px;border:1px solid #EF493D;border-radius:999px;
    background:transparent;color:#EF493D;font:inherit;font-size:13px;cursor:pointer}
  ${read("content/index.css")}
</style>
<div class="note-container">
  <div class="interaction-container">
    <div class="author-wrapper">
      <span class="name">${name}</span>
      <button class="follow" type="button">关注</button>
    </div>
  </div>
  <div class="media-container"></div>
</div>
<script>
  window.chrome = {
    runtime: {
      getURL: () => "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve({}),
    },
  };
  window.filesize = { filesize: (n) => n + " B" };
</script>
<script>${read("js/rn-format.js")}</script>
<script>${read("content/index.js")}</script>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});

async function measure(name) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await p.route("https://www.xiaohongshu.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page(name) })
  );
  await p.goto("https://www.xiaohongshu.com/explore/abc123", { waitUntil: "load" });
  await p.waitForSelector(".xhx-download-container", { state: "attached", timeout: 5000 });
  // 布局稳定后再量：pinGap 在挂载时跑过一次，这里再触发一次确认幂等
  await p.$eval(".xhx-download-container", (el) => el.dispatchEvent(new MouseEvent("mouseenter")));
  const r = await p.evaluate(() => {
    const box = document.querySelector(".xhx-download-container").getBoundingClientRect();
    const follow = document.querySelector(".follow").getBoundingClientRect();
    const wrap = document.querySelector(".author-wrapper").getBoundingClientRect();
    return { gap: Math.round(box.left - follow.right), right: box.right, wrapRight: wrap.right };
  });
  await p.close();
  return r;
}

const cases = [
  ["短名", "AI Lynn"],
  ["中文名", "三个三 | AI工具实测"],
  ["超长名", "某某某某某某某某某某某某某某某某某某某某某某某某某某某"],
];

console.log("\n[1] 三种作者名长度：间距必须一致");
const gaps = [];
for (const [label, name] of cases) {
  const r = await measure(name);
  gaps.push(r.gap);
  ok(Math.abs(r.gap - 8) <= 2, `${label}：间距 ${r.gap}px（目标 8px）`);
  ok(r.right <= r.wrapRight + 1, `${label}：胶囊没有顶出作者行（${Math.round(r.right)} ≤ ${Math.round(r.wrapRight)}）`);
}
ok(new Set(gaps).size === 1, `三种长度间距完全相同（${gaps.join(" / ")}）`);

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
