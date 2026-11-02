/* 视频缺省档：短边 ≤1080P 的最高一档
 * 只测纯函数 pickDefaultQuality，不碰页面。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");

// rn-format.js 是挂在 globalThis.__RN 上的 IIFE，直接 eval 就能拿到导出
new Function(fs.readFileSync(path.join(EXT, "js/rn-format.js"), "utf8"))();
const { videoOptions, pickDefaultQuality } = globalThis.__RN;

const cases = [
  {
    name: "竖屏 4K 与 1080P 并存",
    list: [["1440", "1920"], ["1080", "1920"], ["720", "960"], ["540", "720"]],
    want: 1,
  },
  { name: "只有 1440 与 720", list: [["1440", "1920"], ["720", "960"]], want: 1 },
  { name: "只有 720", list: [["720", "960"]], want: 0 },
  { name: "横屏 1080P 就是 1920×1080", list: [["3840", "2160"], ["1920", "1080"]], want: 1 },
  { name: "全都超过 1080P 退最小", list: [["3840", "2160"], ["2560", "1440"]], want: 1 },
  { name: "尺寸全未知退第一档", list: [[0, 0], [0, 0]], want: 0 },
  { name: "未知档跳过，取第一个有尺寸的合格档", list: [[0, 0], ["1440", "1920"], ["720", "960"]], want: 2 },
  { name: "空表", list: [], want: -1 },
];

let fail = 0;
for (const c of cases) {
  const list = c.list.map(([w, h], i) => ({ url: "u" + i, width: Number(w), height: Number(h) }));
  const got = pickDefaultQuality(list);
  const ok = got === c.want;
  if (!ok) fail++;
  const show = list.map((x) => (x.width ? `${x.width}×${x.height}` : "未知")).join(" ");
  console.log(`${ok ? "✓" : "✗"} ${c.name.padEnd(24)} [${show}] → ${got}${ok ? "" : ` 期望 ${c.want}`}`);
}

// 排序侧的行为也要对得上：videoOptions 必须像素降序，否则「第一个合格档」无从谈起
const stream = {
  h264: [
    { masterUrl: "a", width: 720, height: 960, avgBitrate: 900 },
    { masterUrl: "b", width: 1440, height: 1920, avgBitrate: 5000 },
    { masterUrl: "c", width: 1080, height: 1920, avgBitrate: 3000 },
  ],
};
const opts = videoOptions(stream);
const order = opts.map((o) => o.res).join(" ");
const sortedOk = order === "1440×1920 1080×1920 720×960";
if (!sortedOk) fail++;
console.log(`${sortedOk ? "✓" : "✗"} videoOptions 降序            ${order}`);
const idx = pickDefaultQuality(opts);
const pickOk = opts[idx] && opts[idx].res === "1080×1920";
if (!pickOk) fail++;
console.log(`${pickOk ? "✓" : "✗"} 真实 stream 选中档          ${opts[idx] && opts[idx].res}`);

console.log(fail ? `\n✗ ${fail} 项未通过` : "\n✓ 全部通过");
process.exit(fail ? 1 : 0);
