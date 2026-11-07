/* frontmatter 的「类型」按媒体构成判，不按站方口径
 *
 * 站方只分 video / normal 两档。值得买的好文、Chiphell 的帖子会把一段站内视频
 * 夹在图文里，在站方口径下一律是 normal —— 结果 md 写着「类型: 图文」，
 * 正文中间却躺着一段 mp4。
 *
 * 规则（kindOf）：
 *   有图有视频 → 图文+视频
 *   只有视频   → 视频
 *   只有图     → 图文
 *   一个媒体都没有（纯文字贴）→ 退回站方口径
 *
 * 注意 counts 数的是「笔记里有什么」，不是「这次存了什么」——
 * 用户点「跳过」不改变类型，否则同一篇贴存两次会得到两种类型。
 *
 * 这个用例把这四条钉住，并确认 frontmatter 真的按它写。
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

console.log("\n[1] 四种构成");
ok(RN.kindOf({ counts: { images: 9, videos: 0 } }) === "图文", "9 图 0 视频 → 图文");
ok(RN.kindOf({ counts: { images: 9, videos: 1 } }) === "图文+视频", "9 图 1 视频 → 图文+视频");
ok(RN.kindOf({ counts: { images: 0, videos: 1 } }) === "视频", "0 图 1 视频 → 视频");
ok(RN.kindOf({ counts: { images: 2, videos: 3 } }) === "图文+视频", "2 图 3 视频 → 图文+视频");

console.log("\n[2] 没有媒体 / 没传 counts 时退回站方口径");
ok(RN.kindOf({ counts: { images: 0, videos: 0 }, type: "video" }) === "视频", "站方 video → 视频");
ok(RN.kindOf({ counts: { images: 0, videos: 0 }, type: "normal" }) === "图文", "站方 normal → 图文");
ok(RN.kindOf({ type: "normal" }) === "图文", "压根没传 counts 也不炸");

console.log("\n[3] frontmatter 里那一行真的跟着变");
for (const [counts, want] of [
  [{ images: 3, videos: 1 }, "图文+视频"],
  [{ images: 3, videos: 0 }, "图文"],
  [{ images: 0, videos: 1 }, "视频"],
]) {
  const text = RN.frontmatter({ title: "t", counts });
  ok(text.includes("\n类型: " + want + "\n"), `${JSON.stringify(counts)} → 类型: ${want}`);
}

console.log("\n[4] 四站都传了 counts");
for (const file of ["js/background.js", "content/discuz.js", "content/sspai.js", "content/smzdm.js"]) {
  const src = read(file);
  ok(/counts:\s*{/.test(src), `${file} 传了 counts`);
}

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
