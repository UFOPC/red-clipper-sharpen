/* 打两个包：
 *   dist/小红虾-<版本>.zip        发布版：设置页没有「目录树」开关，公众号固定走通用结构
 *   dist/小红虾-self-<版本>.zip   自用版：带开关，默认「自用·对齐 Wechat-Sharpen」
 *
 * 版本号只有三段（0.X.X），由用户确认；内部流水号只写进本地 dist/BUILD-INFO.txt，
 * 不进包内 manifest、不进包名、不进任何打包产物。见下面 VERSION 处的说明。
 *
 *   node build.mjs
 *
 * 只做文件复制与两处字符串改写，不引入构建链；任何一处替换未命中直接报错退出，
 * 免得发出一个「以为改了其实没改」的包。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
/* 对外版本（0.X.X）由用户确认，脚本绝不改它，也不在它后面加东西。
 * 内部流水号只做本地记账，用来回答「现在手上这个包是 0.8.0 的第几次构建」：
 *   1. 存 .build-serial，每次打包 +1；
 *   2. 汇总写 dist/BUILD-INFO.txt（在 dist 根，不在包里，随 dist 一起被 gitignore）。
 * 包内 manifest.version、zip 文件名、设置页显示的版本号统一都是三段。 */
const VERSION = manifest.version;
const SERIAL_FILE = path.join(ROOT, ".build-serial");
const serial = (fs.existsSync(SERIAL_FILE) ? Number(fs.readFileSync(SERIAL_FILE, "utf8").trim()) || 0 : 0) + 1;
fs.writeFileSync(SERIAL_FILE, String(serial));

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
  "rules/douban-referer.json",
  "rules/weibo-referer.json",
  "content/index.js",
  "content/index.css",
  "content/format-size.js",
  "content/discuz.js",
  "content/discuz.css",
  "content/douban.js",
  "content/douban.css",
  "content/sspai.js",
  "content/sspai.css",
  "content/smzdm.js",
  "content/smzdm.css",
  "content/wechat.js",
  "content/weibo.js",
  "content/xiachufang.js",
  "content/xiachufang.css",
  "content/weibo.css",
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

/* 流水号只落在这里：dist 根目录，不在任何一个包里，也不进 git。
 * 靠 sha256 认领具体某一个包，比记文件名可靠（同名包会被下次构建覆盖）。 */
const info = [
  `版本: ${VERSION}`,
  `流水号: #${serial}`,
  `时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  ...([relZip, selfZip].map((file) => {
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
    return `${path.basename(file)}  sha256:${hash}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
  })),
  "",
].join("\n");
fs.writeFileSync(path.join(DIST, "BUILD-INFO.txt"), info);
console.log(`\n构建流水号 #${serial}（对外版本仍为 ${VERSION}，仅记在 dist/BUILD-INFO.txt）`);
