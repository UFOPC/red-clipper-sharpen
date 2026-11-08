/* 打两个包：
 *   dist/小红虾-<版本>.zip        发布版：设置页没有「目录树」开关，公众号固定走通用结构
 *   dist/小红虾-self-<版本>.zip   自用版：带开关，默认「自用·对齐 Wechat-Sharpen」
 *
 * 版本号只有三段（0.X.X），由用户确认；内部流水号只写进本地 dist/BUILD-INFO.txt，
 * 不进包内 manifest、不进包名、不进任何打包产物。见下面 VERSION 处的说明。
 *
 *   node build.mjs
 *
 * 只做文件复制与两处字符串改写，不引入构建链；替换未命中、manifest 不合法、
 * 引用文件漏进 INCLUDE，一律在打包这一步直接报错退出，
 * 免得发出一个「以为改了其实没改」或「装都装不上」的包。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

/* 打包前先做一次 Chrome 会做的合法性检查。
 * 踩过：web_accessible_resources[].matches 只允许 origin 级模式（路径必须是 /*），
 * 写成 *://m.weibo.cn/status/* 时 Chrome 直接拒绝加载整个扩展，报
 * 「Invalid value for 'web_accessible_resources[0]'. Invalid match pattern.」。
 * content_scripts.matches 反而允许带路径，两者规则不一样，容易顺手抄错。
 * 与其等用户装包时才发现，不如在打包这一步就挡住。 */
for (const [index, war] of (manifest.web_accessible_resources || []).entries()) {
  for (const pattern of war.matches || []) {
    if (!/^(?:\*|https?):\/\/[^/]+\/\*$/.test(pattern)) {
      throw new Error(
        `web_accessible_resources[${index}].matches 非法: ${pattern}\n` +
        `WAR 只认 origin 级模式，路径必须是 /*；要收窄范围请改 content_scripts.matches。`
      );
    }
  }
}

/* 对外版本（0.X.X）由用户确认，脚本绝不改它，也不在它后面加东西。
 * 内部流水号只做本地记账，用来回答「现在手上这个包是当前对外版本的第几次构建」：
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
  "content/weibo-desktop.js",
  "content/weibo.css",
  "content/xiachufang.js",
  "content/xiachufang.css",
  "icons/icon.svg",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

/* 打包前自检：manifest 引用的文件必须都进了 INCLUDE、且在磁盘上真实存在；
 * DNR 规则必须是合法 JSON，且规则 id 全局唯一（Chrome 会因重复 id 拒绝注册）。
 * 这两类错误在装包时才暴露，用户只会看到一句「无法加载扩展」，所以提前挡住。 */
const RULE_RESOURCES = (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources) || [];

function validatePackage() {
  const refs = new Set();
  for (const cs of manifest.content_scripts || []) {
    for (const file of [...(cs.js || []), ...(cs.css || [])]) refs.add(file);
  }
  for (const rr of RULE_RESOURCES) refs.add(rr.path);
  for (const war of manifest.web_accessible_resources || []) {
    for (const file of war.resources || []) refs.add(file);
  }
  if (manifest.action && manifest.action.default_popup) refs.add(manifest.action.default_popup);
  if (manifest.options_ui && manifest.options_ui.page) refs.add(manifest.options_ui.page);
  if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
  for (const file of Object.values(manifest.icons || {})) refs.add(file);
  for (const file of Object.values((manifest.action && manifest.action.default_icon) || {})) refs.add(file);

  for (const file of refs) {
    if (!INCLUDE.includes(file)) throw new Error(`manifest 引用了 ${file}，但它不在 INCLUDE 里`);
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`缺少文件: ${file}`);
  }

  /* content_scripts 覆盖的每个 host 都必须落在某个 WAR matches 里。
   * 内容脚本往页面塞的是 chrome-extension://…/icons/icon.svg，这个资源只对 WAR matches 里的站点开放；
   * 加站时只改 content_scripts.matches、漏了 WAR，胶囊上就没有图标（裂图），
   * 功能全正常、e2e 也断言不到，所以在这里挡。 */
  const hostOf = (pattern) => {
    const match = /^(?:\*|https?):\/\/([^/]+)\//.exec(pattern);
    return match ? match[1].toLowerCase() : "";
  };
  const warHosts = (manifest.web_accessible_resources || [])
    .flatMap((war) => (war.matches || []).map(hostOf))
    .filter(Boolean);
  const covered = (host) =>
    warHosts.some((item) => item === host || (item.startsWith("*.") && host.endsWith(item.slice(1))));
  for (const cs of manifest.content_scripts || []) {
    for (const pattern of cs.matches || []) {
      const host = hostOf(pattern);
      if (!host) throw new Error(`content_scripts.matches 无法解析出域名: ${pattern}`);
      if (!covered(host))
        throw new Error(
          `content_scripts 覆盖了 ${host}，但没有任何 web_accessible_resources.matches 覆盖它\n` +
          `内容脚本要加载 icons/icon.svg，漏配会让胶囊图标裂图。`
        );
    }
  }

  const ids = new Set();
  for (const rr of RULE_RESOURCES) {
    const rules = JSON.parse(fs.readFileSync(path.join(ROOT, rr.path), "utf8"));
    for (const rule of rules) {
      if (ids.has(rule.id)) throw new Error(`DNR 规则 id 重复: ${rule.id}（${rr.path}）`);
      ids.add(rule.id);
    }
  }
}
validatePackage();

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
