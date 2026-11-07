/* 打两个包：
 *   dist/小红虾-<版本>.zip        发布版：设置页没有「目录树」开关，公众号固定走通用结构
 *   dist/小红虾-self-<版本>.zip   自用版：带开关，默认「自用·对齐 Wechat-Sharpen」
 *
 *   node build.mjs
 *
 * 只做文件复制与两处字符串改写，不引入构建链；任何一处替换未命中直接报错退出，
 * 免得发出一个「以为改了其实没改」的包。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const VERSION = manifest.version;

/* 扩展运行所需的文件，显式列出——test/ 与 docs/ 永远不进包 */
const INCLUDE = [
  "manifest.json",
  "setting.html",
  "LICENSE",
  "NOTICE",
  "js/background.js",
  "js/rn-format.js",
  "js/setting.js",
  "js/setting.css",
  "rules/media-referer.json",
  "content/index.js",
  "content/index.css",
  "content/format-size.js",
  "content/discuz.js",
  "content/discuz.css",
  "content/sspai.js",
  "content/sspai.css",
  "content/smzdm.js",
  "content/smzdm.css",
  "content/wechat.js",
  "icons/icon.svg",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

const SECTION = /\n    <section aria-label="公众号保存格式">[\s\S]*?<\/section>/;

/* 自用版把默认值翻过来：storage 里没有 layout 时走 sharpen */
const SELF_RULES = [
  ['let layoutMode = "native";', 'let layoutMode = "sharpen";'],
  [
    'layoutMode = data && data[LAYOUT_KEY] === "sharpen" ? "sharpen" : "native";',
    'layoutMode = data && data[LAYOUT_KEY] === "native" ? "native" : "sharpen";',
  ],
];

function copyInto(target, transform) {
  for (const rel of INCLUDE) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`缺少文件: ${rel}`);
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let body = fs.readFileSync(src);
    if (transform && transform[rel]) body = transform[rel](body.toString("utf8"));
    fs.writeFileSync(dest, body);
  }
}

function zip(dir, name) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { force: true });
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${dir}\\*' -DestinationPath '${out}' -Force`,
  ], { stdio: "inherit" });
  return out;
}

fs.rmSync(DIST, { recursive: true, force: true });

/* ---- 发布版 ---- */
const relDir = path.join(DIST, `小红虾-${VERSION}`);
copyInto(relDir, {
  "setting.html": (html) => {
    if (!SECTION.test(html)) throw new Error("发布版：找不到公众号保存格式的 section");
    return html.replace(SECTION, "");
  },
});
const relZip = zip(relDir, `小红虾-${VERSION}.zip`);

/* ---- 自用版 ---- */
const selfDir = path.join(DIST, `小红虾-self-${VERSION}`);
copyInto(selfDir, {
  "content/wechat.js": (src) => {
    let out = src;
    for (const [from, to] of SELF_RULES) {
      if (!out.includes(from)) throw new Error(`自用版：wechat.js 未命中替换 —— ${from}`);
      out = out.replace(from, to);
    }
    return out;
  },
});
const selfZip = zip(selfDir, `小红虾-self-${VERSION}.zip`);

for (const file of [relZip, selfZip]) {
  const size = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`${path.basename(file)}  ${size} KB`);
}
