/* 少数派胶囊位置实测：面板向左下展开会不会出屏
 *
 * 少数派是唯一还向右下的站，理由是胶囊挂在文章头部，向左会顶到屏幕外。
 * 这个「会出屏」不能靠猜 —— 直接量真实文章页里胶囊的坐标，
 * 再算 right:0 时面板左边缘落在哪里。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PW_ROOT = process.env.PW_ROOT || "C:/Users/China/.workbuddy-ai/binaries/node/workspace/node_modules";
const { chromium } = require(path.join(PW_ROOT, "playwright"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const URLS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://sspai.com/post/116991"];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xhx-sp-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
});

for (const url of URLS) {
  const page = await ctx.newPage();
  console.log(`\n=== ${url} ===`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector(".sspai-xhx-slot", { timeout: 20000 });
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const slot = document.querySelector(".sspai-xhx-slot");
      const s = slot.getBoundingClientRect();
      const panel = document.querySelector(".sspai-xhx-panel");
      // 临时展开并量两种方向
      slot.classList.add("is-open");
      const pw = panel.getBoundingClientRect().width;
      const left = { x: s.x, right: s.x + pw };
      const right = { x: s.x + s.width - pw, right: s.x + s.width };
      slot.classList.remove("is-open");
      const anchor = slot.parentElement;
      return {
        vw: window.innerWidth,
        slot: { x: Math.round(s.x), right: Math.round(s.x + s.width), w: Math.round(s.width) },
        panelW: Math.round(pw),
        anchor: anchor ? anchor.className : "",
        curLeft: Math.round(left.x),
        curRight: Math.round(right.x),
        dir: getComputedStyle(panel).left === "0px" ? "left:0（向右下）" : "right:0（向左下）",
      };
    });

    console.log(`  锚点容器   ${info.anchor}`);
    console.log(`  胶囊       x=${info.slot.x}  right=${info.slot.right}  宽=${info.slot.w}`);
    console.log(`  面板宽     ${info.panelW}`);
    console.log(`  当前方向   ${info.dir}`);
    console.log(
      `  若改向左   左边缘=${info.curRight}  ${info.curRight >= 0 ? "✅ 不出屏" : "❌ 出屏 " + info.curRight + "px"}`
    );
    console.log(
      `  保持向右   右边缘=${info.curLeft + info.panelW}  ${
        info.curLeft + info.panelW <= info.vw ? "✅ 不出屏" : "❌ 出屏"
      }`
    );

    await page.locator(".sspai-xhx-slot").evaluate((el) => el.classList.add("is-open"));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(HERE, `sspai-pos-${url.split("/").pop()}.png`),
      clip: { x: 0, y: Math.max(0, info.slot.x < 400 ? 80 : 80), width: 1440, height: 420 },
    });
  } catch (e) {
    console.log("  失败：" + String(e).split("\n")[0]);
  }
  await page.close();
}

await ctx.close();
