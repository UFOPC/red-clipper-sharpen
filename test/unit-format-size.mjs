/* 体积格式化口径（unit）
 *
 * 这条测试的价值在于「锁住用户看得见的字符」：面板上的 2.4 MB、进度里的 1.5 kB
 * 一旦变样，用户会以为下载大小不对。期望值全部由旧第三方库逐值跑出来对齐过，
 * 不是拍脑袋写的。
 *
 * 口径要点：1000 进制、kB 用小写 k、>1 kB 保留两位小数并去尾零、999999 → 1 MB。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

await import(pathToFileURL(path.join(ROOT, "content/format-size.js")).href);
const format = globalThis.formatSize;
assert.equal(typeof format, "function", "必须暴露 formatSize");

const CASES = [
  [0, "0 B"],
  [1, "1 B"],
  [512, "512 B"],
  [697000, "697 kB"],
  [999, "999 B"],
  [1000, "1 kB"],
  [1024, "1.02 kB"],
  [1025, "1.02 kB"],
  [1500, "1.5 kB"],
  [9994, "9.99 kB"],
  [9995, "9.99 kB"],
  [9999, "10 kB"],
  [10000, "10 kB"],
  [99999, "100 kB"],
  [999949, "999.95 kB"],
  [999950, "999.95 kB"],
  [999999, "1 MB"],
  [1000000, "1 MB"],
  [1048576, "1.05 MB"],
  [1234567, "1.23 MB"],
  [2500000, "2.5 MB"],
  [999999999, "1 GB"],
  [1e12, "1 TB"],
  [1e15, "1 PB"],
  [1e18, "1 EB"],
  [1e21, "1 ZB"],
  [-512, "-512 B"],
  [-2500000, "-2.5 MB"],
  [0.4, "0 B"],
  [null, "0 B"],
];

let failed = 0;
for (const [input, want] of CASES) {
  const got = format(input);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${String(input).padStart(10)} → ${got}${ok ? "" : `  期望 ${want}`}`);
}

// 非法输入沿用旧行为：抛 TypeError，不能静默返回 "NaN B"
for (const bad of ["abc", undefined, NaN, Infinity]) {
  let threw = false;
  try {
    format(bad);
  } catch (error) {
    threw = error instanceof TypeError;
  }
  if (!threw) failed++;
  console.log(`  ${threw ? "PASS" : "FAIL"}  ${String(bad).padStart(10)} → 抛 TypeError`);
}

// 兼容入口必须与 formatSize 完全等价（既有调用点走 filesize.filesize）
assert.equal(globalThis.filesize.filesize(2500000), format(2500000), "兼容入口必须等价");

if (failed) {
  console.error(`\n${failed} 项未通过`);
  process.exit(1);
}
console.log("\n✓ unit-format-size: 口径与旧库逐字符一致");
