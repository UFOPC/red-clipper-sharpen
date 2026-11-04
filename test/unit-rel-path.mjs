/* 四站统一目录与 md 相对路径规范
 *
 * 标题里的空白与括号在 layout() 阶段去掉；作者名等其余片段仍可能含 URI 不安全字符，
 * 所以 rel() 必须继续把空格/括号/井号/百分号转成 %XX，且不能多一层编码。
 *
 * 这个用例守四件事：
 *   ① rel() 的转义与反转义对称，中文与全角标点原样保留
 *   ② 四个站 + 后台没有任何地方还在手写 `](./`
 *   ③ 四站都走 layout()/mediaPath()，不再自行拼作者目录和平铺媒体
 *   ④ 标题目录、MD、评论 JSON、正文媒体、评论图的命名与示例完全一致
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(EXT, p), "utf8");

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

/* rn-format.js 是 IIFE，挂到 globalThis.__RN 上，直接 eval 即可 */
new Function(read("js/rn-format.js"))();
const RN = globalThis.__RN;

/* 链接目标里不能出现的裸字符：空格、半角括号、引号、尖括号、井号、问号。
 * % 单独判——只允许 %XX 这种合法转义，裸的 % 会被再解码一次。 */
const UNSAFE = /[ ()<>[\]{}"'`|\\^?#]/;
const BAD_PERCENT = /%(?![0-9A-Fa-f]{2})/;

console.log("\n[1] 该转义的都转了");
const cases = [
  ["2026.08.03_九天八夜走进新疆：从 S101 峡谷到伊犁草原_张三-1.png", "标题里的空格"],
  ["a b c.jpg", "连续空格"],
  ["（上） (1).png", "半角括号"],
  ["标题 #tag.md", "井号（否则被当锚点）"],
  ["100%完成.png", "百分号（否则二次解码）"],
  ["Q?A.jpg", "问号（否则被当查询串）"],
];
for (const [name, why] of cases) {
  const out = RN.rel(name);
  ok(out.startsWith("./"), `rel("${name}") 以 ./ 开头（${out.slice(0, 24)}…）`);
  ok(!UNSAFE.test(out.slice(2)) && !BAD_PERCENT.test(out.slice(2)), `${why}：目标里没有裸的不安全字符（${out}）`);
  ok(decodeURIComponent(out.slice(2)) === name, `${why}：反转义能还原原名`);
}

console.log("\n[2] 中文与全角标点保持可读");
const cjk = RN.rel("2026.10.27_一支毛笔，一本旧杂志_胡九思-1.jpg");
ok(cjk.includes("一支毛笔"), `中文没被编码（${cjk}）`);
ok(cjk.includes("，"), "全角逗号没被编码");
ok(!cjk.includes(" "), "空格已编码");

console.log("\n[3] rel() 认的是相对路径，不是绝对路径");
ok(RN.rel("") === "./", `空路径退化成 ./（实际 "${RN.rel("")}"）`);
ok(RN.rel("./x.png") === "./x.png", `传进来的 ./ 前缀不会叠加（实际 "${RN.rel("./x.png")}"）`);

console.log("\n[4] 四站脚本与后台都走 rel()，没人再手写『](./』");
const files = ["js/background.js", "content/chiphell.js", "content/smzdm.js", "content/sspai.js"];
for (const file of files) {
  const src = read(file);
  /* 注释里可以提到这种写法，只看代码行 */
  const code = src
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
  const hits = [...code.matchAll(/\]\(\.\/\$\{/g)].map((m) => m[0]);
  ok(hits.length === 0, `${file} 不再手写相对链接（命中 ${hits.length} 处）`);
  ok(/RN\.rel\(|__RN\.rel\(/.test(code), `${file} 用上了 rel()`);
  ok(/RN\.layout\(/.test(code), `${file} 用上了统一 layout()`);
  ok(/RN\.mediaPath\(/.test(code), `${file} 用上了统一 mediaPath()`);
  ok(!/RN\.dir\([^)]*,/.test(code), `${file} 不再生成作者目录`);
}
const xhsOriginal = read("content/index.js");
ok(xhsOriginal.includes('RN.mediaPath(layout.mediaStem, 1, ".mp4", true)'), "小红书无水印原片也进入 media/ 并使用 01 序号");
ok(xhsOriginal.includes("mdFilename: layout.md"), "小红书原视频附带的 MD 使用统一文件名");

console.log("\n[5] markdown() 的媒体清单也走 rel()");
const md = RN.markdown({ title: "标题 带空格", desc: "正文", media: ["2026.01.01_标题 带空格_作者-1.png"] });
const line = md.split("\n").find((l) => l.startsWith("!["));
ok(!!line && !line.includes(" "), `媒体行没有裸空格（${line}）`);
ok(!!line && decodeURIComponent(line.slice(line.indexOf("(") + 1, -1)).endsWith("-1.png"), "媒体行反转义后对得上文件名");

console.log("\n[6] 四站共享的真实目录与命名");
const stamp = 1762000000000;
const date = RN.dateParts(stamp).date;
const layout = RN.layout("标题 （带） [空格]", "作者", stamp);
ok(layout.prefix === "标题带空格/", `只保留清洗后的标题目录（${layout.prefix}）`);
ok(layout.md === `标题带空格/${date}_标题带空格_作者.md`, `MD 含作者且无额外结尾连字符（${layout.md}）`);
ok(layout.comments === `标题带空格/${date}_标题带空格-comments.json`, `评论 JSON 不含作者（${layout.comments}）`);
ok(RN.mediaPath(layout.mediaStem, 1, ".png") === `images/${date}_标题带空格-01.png`, "正文图片进 images/，序号两位");
ok(RN.mediaPath(layout.mediaStem, 2, ".jpg") === `images/${date}_标题带空格-02.jpg`, "第二张正文图片连续编号");
ok(RN.mediaPath(layout.mediaStem, 1, ".mp4", true) === `media/${date}_标题带空格-01.mp4`, "视频进 media/，与图片各自从 01 编号");
ok(RN.commentPath(layout.mediaStem, 1, 1, ".png") === `comments/${date}_标题带空格-01-c1.png`, "一级评论图：一级序号 01 + 全局 c1");
ok(RN.commentPath(layout.mediaStem, 1, 2, ".png") === `comments/${date}_标题带空格-01-c2.png`, "二级评论沿用一级序号，全局序号递增");
ok(RN.commentPath(layout.mediaStem, 2, 3, ".png") === `comments/${date}_标题带空格-02-c3.png`, "下一个一级评论进入 02 段，cN 不重置");
const untitled = RN.layout("", "作者", stamp);
ok(untitled.prefix === `未命名文件_作者_${date}/`, `无标题时使用作者与日期兜底目录（${untitled.prefix}）`);
ok(untitled.md === `未命名文件_作者_${date}/${date}_作者.md`, `无标题 MD 仍保留日期和作者（${untitled.md}）`);
ok(RN.mediaPath(untitled.mediaStem, 1, ".png") === `images/${date}-01.png`, "无标题媒体沿用日期主干与两位序号");
ok(RN.layout("", "作者", stamp).prefix === untitled.prefix, "同一篇重复保存时兜底目录保持稳定");
ok(RN.layout("", "另一位", stamp).prefix !== untitled.prefix, "不同作者的无标题笔记分目录");
ok(RN.layout("", "作者", stamp + 86400000).prefix !== untitled.prefix, "同作者不同日期的无标题笔记分目录");
ok(RN.layout("", "", stamp).prefix === `未命名文件_未知作者_${date}/`, "作者也缺失时使用未知作者兜底");

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
