/* 落盘名的清洗与长度闸门
 *
 * chrome.downloads.download 会在**调用时**校验 filename，非法直接 reject 报
 * `Invalid filename`——不是截断、不是跳过。命中时整篇 md 一个字节都不落，
 * 而且 content 侧连写「某张图没存上」的机会都没有。所以 name() 守的是 P0。
 *
 * 被 Chrome 拒绝、而早年 name() 会原样放行的几类（逐条实测得出）：
 *   Cf 格式符（LRM/RLM/软连字符/word joiner/ZWJ）、Cc 里的 C1 段、Cn 非字符、
 *   ~、NTFS 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，带不带扩展名都算）
 *
 * 另一半是长度：标题里的空白/括号去掉后仍可能很长，叠上日期_标题_作者 与
 * 下载根目录后容易撞 Windows 的 260。闸门放在 titleName()/nickName()（60/24 码点），
 * 不放进 name()——name() 不知道自己会被拼进目录名还是文件名。
 *
 * 这个用例守六件事：
 *   ① 五类非法字符 + ~ 全部被清掉
 *   ② NTFS 保留名加下划线前缀，且 COM10 这类非保留名不许误伤
 *   ③ 120 字标题的 md 路径 ≤ 150；最坏情况（标题 60 + 作者 24）≤ 200
 *   ④ 短标题逐字不变（拿 e2e 基线当期望值，钉死"清洗不许过度"）
 *   ⑤ emoji 仍被删（Cf 扩表没改变原有行为）
 *   ⑥ 代理对不被切半个（判据与切片都按码点）
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

new Function(read("js/rn-format.js"))();
const RN = globalThis.__RN;

/* 用本地时间构造，避开时区差异：期望值里的日期就是这里给的日期。 */
const MS = new Date(2022, 11, 31, 9, 30, 0).getTime();

console.log("\n[1] 非法字符");
for (const [label, input, want] of [
  ["LRM(U+200E)", "a\u200Eb", "ab"],
  ["RLM(U+200F)", "a\u200Fb", "ab"],
  ["软连字符(U+00AD)", "a\u00ADb", "ab"],
  ["word joiner(U+2060)", "a\u2060b", "ab"],
  ["C1 控制符(U+0085)", "a\u0085b", "ab"],
  ["非字符(U+FDD0)", "a\uFDD0b", "ab"],
  ["波浪号 ~", "a~b", "ab"],
]) {
  ok(RN.name(input) === want, `${label} 被清掉 → ${JSON.stringify(want)}`);
}

console.log("\n[2] NTFS 保留名：加前缀，但不许误伤");
ok(RN.name("CON") === "_CON", "CON → _CON");
ok(RN.name("NUL.md") === "_NUL.md", "NUL.md → _NUL.md");
ok(RN.name("COM1") === "_COM1", "COM1 → _COM1");
ok(RN.name("LPT9") === "_LPT9", "LPT9 → _LPT9");
ok(RN.name("COM10") === "COM10", "COM10 不是保留名，必须保持原样");
ok(RN.name("CONSOLE") === "CONSOLE", "CONSOLE 不是保留名，必须保持原样");

console.log("\n[3] 长度闸门");
const md120 = RN.layout("A".repeat(120), "作者名", MS).md;
ok(md120.length <= 150, `120 字标题的 md 路径 ${md120.length} 字符 ≤ 150`);
const mdWorst = RN.layout("B".repeat(80), "C".repeat(30), MS).md;
ok(mdWorst.length <= 200, `最坏情况（标题 80→60、作者 30→24）md 路径 ${mdWorst.length} 字符 ≤ 200`);
ok(RN.dir("A".repeat(120), "作者名", MS) === "A".repeat(60), "目录名按 60 码点截断");
ok(
  RN.layout("红烧肉教程集锦", "作".repeat(40), MS).md.endsWith("_" + "作".repeat(24) + ".md"),
  "作者名按 24 码点截断"
);
const media = RN.mediaPath(RN.layout("A".repeat(120), "作者名", MS).mediaStem, 1, ".jpg");
ok(media.length <= 150, `媒体路径 ${media.length} 字符 ≤ 150（同一 mediaStem）`);

console.log("\n[4] 短标题逐字不变（防清洗过度）");
ok(
  RN.layout("红烧肉教程集锦", "愿爱常甜", MS).md === "红烧肉教程集锦/2022.12.31_红烧肉教程集锦_愿爱常甜.md",
  "红烧肉教程集锦/2022.12.31_红烧肉教程集锦_愿爱常甜.md"
);
ok(RN.name("红烧肉教程集锦") === "红烧肉教程集锦", "普通标题 name() 原样返回");
ok(
  RN.layout("标题 （带） [空格]", "张三", MS).md === "标题带空格/2022.12.31_标题带空格_张三.md",
  "空白与括号仍只从路径里去掉，md 正文标题不受影响"
);

console.log("\n[5] emoji 仍被删（Cf 扩表没改变原有行为）");
ok(RN.name("红烧肉👨‍👩‍👧集锦") === "红烧肉集锦", "ZWJ 组合 emoji 整体删除");
ok(RN.name("红烧肉🍲集锦") === "红烧肉集锦", "单体 emoji 删除");

console.log("\n[6] 代理对不被切半个");
const rare = "\u{20000}".repeat(50); // 50 个码点 / 100 个码元，不该被截
ok(RN.name(rare) === rare, "50 个增补平面汉字（码元 100）不被误截");
/* 截断在 titleName() 里做，name() 只管字符——所以这里经 dir() 验 */
const rareDir = RN.dir("\u{20000}".repeat(120), "作者", MS);
ok([...rareDir].length === 60, `120 个增补平面汉字按 60 码点截断（实得 ${[...rareDir].length} 码点 / ${rareDir.length} 码元）`);
ok(rareDir.length === 120, "60 个增补平面汉字的码元数是 120，说明切的是整字符");

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
