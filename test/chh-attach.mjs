/* Chiphell：没插进正文的附件图必须一起抓
 *
 * Discuz 把作者上传但没插进正文的图排在帖子底部的附件格里：
 *   <div class="pattl"><ignore_js_op><dl class="tattl attm"><div class="mbn savephotop">
 *       <img id="aimg_…" src="none.gif" zoomfile="…">
 * 这块在 td.plc 里、td.t_f 之外。只扫 td.t_f 会整批漏掉——真实帖 tid=2915041
 * 正文 7 张 + 附件格 29 张 = 36 张，旧版只存 7 张。
 *
 * 同时锁两件事：
 *   1) 附件格要算进「正文」与面板张数；
 *   2) 同一张图既插正文又留在附件格时只出现一次（按 URL 去重）。
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
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
  };
  window.filesize = { filesize: (n) => Math.round(n / 1024) + " KB" };
};

const html = `<!doctype html><meta charset="utf-8">
<div id="hd" style="height:60px">页头</div>
<div id="pt"><a href="/">论坛</a></div>
<h1 id="thread_subject">附件格测试</h1>
<div id="postlist">
  <div id="post_9001">
    <div class="authi"><a class="xw1">作者乙</a></div>
    <em id="authorposton9001">发表于 2026-11-04 20:43</em>
    <table><tbody><tr>
      <td class="plc">
        <table><tbody><tr><td class="t_f" id="postmessage_9001">
          正文一段
          <ignore_js_op><img id="aimg_1" src="static/image/common/none.gif" zoomfile="https://img.test/a.jpg"></ignore_js_op>
          <br>
          <ignore_js_op><img id="aimg_2" src="static/image/common/none.gif" zoomfile="https://img.test/b.jpg"></ignore_js_op>
          <br>正文二段
          <a href="https://img.test/e.jpg"><img src="static/image/common/none.gif" zoomfile="https://img.test/e.jpg"></a>
          <br><a href="https://example.com/x">示例链接</a>
        </td></tr></tbody></table>
        <div class="pattl">
          <ignore_js_op><dl class="tattl attm"><dd><div class="mbn savephotop">
            <img id="aimg_1" src="static/image/common/none.gif" zoomfile="https://img.test/a.jpg">
          </div></dd></dl></ignore_js_op>
          <ignore_js_op><dl class="tattl attm"><dd><div class="mbn savephotop">
            <img id="aimg_3" src="static/image/common/none.gif" zoomfile="https://img.test/c.png">
          </div></dd></dl></ignore_js_op>
          <ignore_js_op><dl class="tattl attm"><dd><div class="mbn savephotop">
            <img id="aimg_4" src="static/image/common/none.gif" zoomfile="https://img.test/d.jpg">
          </div></dd></dl></ignore_js_op>
          <ignore_js_op><dl class="tattl attc"><dd>
            <img src="static/image/filetype/zip.gif" alt="附件">
          </dd></dl></ignore_js_op>
        </div>
      </td>
    </tr></tbody></table>
  </div>
  <div id="post_9002">
    <div class="authi"><a class="xw1">路人丙</a></div>
    <table><tbody><tr><td class="plc">
      <table><tbody><tr><td class="t_f" id="postmessage_9002">
        <div class="quote">引用别人的话</div>
        回一句
        <div class="pattl"><ignore_js_op><dl class="tattl attm"><dd><div class="mbn savephotop">
          <img src="static/image/common/none.gif" zoomfile="https://img.test/reply-only.jpg">
        </div></dd></dl></ignore_js_op></div>
      </td></tr></tbody></table>
    </td></tr></tbody></table>
  </div>
</div>`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    "C:/Users/China/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  headless: true,
});
const p = await browser.newPage();
await p.route("https://www.chiphell.com/**", (r) =>
  r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
);
await p.addInitScript(stubChrome);
await p.goto("https://www.chiphell.com/forum.php?mod=viewthread&tid=9000&page=1&authorid=123", {
  waitUntil: "domcontentloaded",
});
await p.addScriptTag({ content: read("js/rn-format.js") });
await p.addScriptTag({ content: read("content/chiphell.js") });
await p.waitForSelector(".xhx-chh-btn", { timeout: 5000 });

await p.hover(".xhx-chh-btn");
await p.waitForFunction(() => !document.querySelector(".xhx-chh-panel").hidden, null, { timeout: 5000 });
ok((await p.locator(".xhx-chh-key .cnt").textContent()).includes("5 张"), "面板张数把附件格与图片链接算进来（5 张，非图片附件不计）");

await p.click(".xhx-chh-btn");
await p.waitForFunction(() => document.querySelector(".xhx-chh-status").textContent.trim() !== "", null, {
  timeout: 8000,
});
const files = await p.evaluate(() =>
  window.__sent
    .filter((m) => m.type === "downloadFiles")
    .flatMap((m) => m.data.files)
    .map((f) => ({ filename: f.filename, url: f.url || "", text: f.text || "" }))
);
const imgs = files.filter((f) => f.url);
ok(imgs.length === 5, `5 张图全部落盘（实际 ${imgs.length}）`);
ok(
  !imgs.some((f) => f.url.includes("reply-only")),
  "别人的回复图不进正文"
);
const md = files.find((f) => f.text)?.text || "";
const refs = [...md.matchAll(/!\[(\d+)\]\(([^)]+)\)/g)].map((m) => m[1]);
ok(refs.length === 5, `MD 里 5 处图片引用（实际 ${refs.length}）`);
ok(new Set(refs).size === refs.length, "正文与附件格重复的图只引用一次");
ok(/正文一段/.test(md) && /正文二段/.test(md), "正文文字未被附件格挤掉或重复");
ok(md.includes("[示例链接](https://example.com/x)"), "纯文字链接仍保留为 Markdown 链接");
ok(!/\.zip/.test(md), "非图片附件（zip 图标）不生成图片引用");

await browser.close();
if (fails.length) {
  console.log("\n✗ " + fails.length + " 项失败");
  process.exit(1);
}
console.log("\n✓ 全部通过");
