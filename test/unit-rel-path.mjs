/* md 里的相对路径必须是合法 URI —— 标题带空格时最容易踩
 *
 * 现场：`![1](./2026.08.03_九天八夜走进新疆：从 S101 峡谷到伊犁草原_张三-1.png)`
 * 这种写法在 CommonMark 里**不是图片**，整行原样显示成文字，一张图都出不来。
 * 实测 markdown-it（CommonMark 模式）：
 *   ![1](./a b.png)     -> <p>![1](./a b.png)</p>      ← 文字
 *   ![1](<./a b.png>)   -> <img src="./a%20b.png">      ← 图片
 *   ![1](./a%20b.png)   -> <img src="./a%20b.png">      ← 图片
 * 落盘的文件名里就是有空格，所以只能转义引用，不能改文件名。
 *
 * 这个用例守三件事：
 *   ① rel() 把空格/括号/井号/百分号转成 %XX，中文与全角标点原样保留
 *   ② 反转义后能还原成磁盘上真实存在的那个文件名（不会多一层编码）
 *   ③ 四个站 + 后台没有任何地方还在手写 `](./`
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
}

console.log("\n[5] markdown() 的媒体清单也走 rel()");
const md = RN.markdown({ title: "标题 带空格", desc: "正文", media: ["2026.01.01_标题 带空格_作者-1.png"] });
const line = md.split("\n").find((l) => l.startsWith("!["));
ok(!!line && !line.includes(" "), `媒体行没有裸空格（${line}）`);
ok(!!line && decodeURIComponent(line.slice(line.indexOf("(") + 1, -1)).endsWith("-1.png"), "媒体行反转义后对得上文件名");

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
