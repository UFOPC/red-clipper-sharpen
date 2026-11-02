/* 体积格式化：字节 → 人类可读（"697 B" / "2.4 MB"）。
 *
 * 只做一件事，所以自己写，不引第三方库。
 * 口径必须与旧版一致，否则面板上的数字会变样：
 *   - 1000 进制（不是 1024），单位 B / KB / MB / GB / TB
 *   - 大于 1 KB 时保留两位小数并去掉尾零（2.4 MB 而非 2.40 MB）
 *   - 进位边界按 1000 处理：999999 → 1 MB，不是 999.99 KB
 *   - 非法输入抛 TypeError，与旧行为一致（调用方均有 try 或只传数字）
 *
 * 暴露两个入口：
 *   formatSize(n)              —— 新代码用这个
 *   globalThis.filesize.filesize(n) —— 兼容既有调用点和测试桩，行为完全相同
 */
(() => {
  // 注意 kB 是小写 k：SI 规范如此，旧库也这么输出，面板上的数字要与之逐字符一致。
  const UNITS = ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const STEP = 1000;
  const DECIMALS = 2;

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value)) throw new TypeError("Invalid number");
    const negative = value < 0;
    const size = Math.abs(value);
    if (size === 0) return "0 B";

    let exponent = Math.floor(Math.log(size) / Math.log(STEP));
    if (!Number.isFinite(exponent) || exponent < 0) exponent = 0;
    const maxExponent = UNITS.length - 1;
    if (exponent > maxExponent) exponent = maxExponent;

    // 字节档取整，更大档保留两位小数。
    const precision = Math.pow(10, exponent > 0 ? DECIMALS : 0);
    let scaled = Math.round((size / Math.pow(STEP, exponent)) * precision) / precision;

    // 999950 → 999.95 KB 四舍五入后可能正好等于 1000，要再进一档。
    if (scaled === STEP && exponent < maxExponent) {
      scaled = 1;
      exponent += 1;
    }

    return (negative ? "-" : "") + scaled + " " + UNITS[exponent];
  }

  globalThis.formatSize = formatSize;
  globalThis.filesize = { filesize: formatSize };
})();
