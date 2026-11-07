/* md / comments.json 的「确知写完了才报成功」
 *
 * chrome.downloads.download() 的 promise 在**下载条目建出来**时就 resolve，
 * 磁盘满、路径超长、权限不足这类失败会在之后异步变成 interrupted——
 * 只等 promise 的话，`downloadOne` 一律返回 ok，UI 报「已保存」而文件根本不存在。
 *
 * 所以对小文件（text/markdown、application/json）加一层有界等待：
 *   onChanged 收到 complete    → 成功
 *   onChanged 收到 interrupted → 失败，带上 Chrome 给的 error code
 *   3 秒内什么都没有            → 按成功（宁可漏报，不把杀软扫尾误判成失败）
 * 视频/大图不进这条路：等待会把 service worker 吊在一次长下载上。
 *
 * 这个用例守五件事（后三条是行为契约，只断结果不够）：
 *   ① interrupted → failed 带 error，且不影响同一批里的其他文件
 *   ② complete → failed 为空
 *   ③ 一直 in_progress → 超时按成功，且**耗时 ≥ 3000ms**（证明等待真的发生）
 *   ④ 大图 → **耗时 < 100ms**（证明根本没走等待）
 *   ⑤ comments.json 同样走等待，并且**事件一到就收尾**（不等满 3 秒）
 *   ⑥ 事件全错过、3s 后才是 interrupted → 超时点的终局校验必须抓到（否则误报成功）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails.push(msg);
};

/* ---------- 可编程的 chrome 桩 ----------
 * plan 是队列：每次 downloads.download 消费一条，描述这个 id 的结局。
 *   search   —— search({id}) 回报的 state（complete / interrupted / in_progress）
 *   searchSeq—— 按次覆盖 search 的返回值（数组，每次调用 shift 一个；元素可为 state
 *               字符串或 {state,error}），用来测「首次 in_progress、超时点才 interrupted」
 *   error    —— 上面那条 state 对应的 error code
 *   emit     —— 主动发一次 onChanged（{state, error, after:毫秒}），用来测事件路径
 */
let listener;
let seq = 0;
const calls = [];
const plan = [];
const states = new Map();
const handlers = new Set();

globalThis.chrome = {
  runtime: { onMessage: { addListener(fn) { listener = fn; } } },
  scripting: { async executeScript() { return [{ result: undefined }]; } },
  downloads: {
    async download(options) {
      calls.push(options);
      const id = ++seq;
      const spec = plan.shift() || { search: "complete" };
      states.set(id, spec);
      if (spec.emit) {
        setTimeout(() => {
          const delta = { id, state: { current: spec.emit.state } };
          if (spec.emit.error) delta.error = { current: spec.emit.error };
          for (const fn of [...handlers]) fn(delta);
        }, spec.emit.after == null ? 0 : spec.emit.after);
      }
      return id;
    },
    async search({ id: wanted }) {
      const spec = states.get(wanted) || {};
      let state = spec.search || "complete";
      let error = spec.error;
      /* searchSeq 按调用顺序消费：第 1 次是监听落地兜竞态，第 2 次是 3s 超时点的终局校验。
       * 元素可以是 state 字符串，也可以是 { state, error }。 */
      if (Array.isArray(spec.searchSeq) && spec.searchSeq.length) {
        const next = spec.searchSeq.shift();
        if (typeof next === "string") state = next;
        else if (next && typeof next === "object") {
          state = next.state || state;
          error = next.error || error;
        }
      }
      const item = { state };
      if (error) item.error = error;
      return [item];
    },
    onChanged: {
      addListener(fn) { handlers.add(fn); },
      removeListener(fn) { handlers.delete(fn); },
    },
  },
};

await import(pathToFileURL(path.join(EXT, "js/background.js")).href);

const ask = (message) => new Promise((resolve) => listener(message, { tab: { id: 7 } }, resolve));
const md = (filename = "标题/a.md") => ({ type: "downloadFiles", data: { files: [{ filename, text: "# x", mime: "text/markdown" }] } });

console.log("\n[1] md 异步 interrupted");
plan.push({ search: "interrupted", error: "Invalid filename" });
let res = await ask(md());
ok(res.failed.length === 1, "failed 里有一条");
ok(res.failed[0] && res.failed[0].error === "Invalid filename", "error 原样透传：" + (res.failed[0] || {}).error);
ok(res.failed[0] && res.failed[0].filename === "标题/a.md", "failed 里带得出是哪个文件");
ok(res.done === 0, "done 不计这条");

console.log("\n[2] md complete");
plan.push({ search: "complete" });
res = await ask(md());
ok(res.failed.length === 0 && res.done === 1, "成功且 failed 为空");
ok(res.cancelled === false, "cancelled 为 false");

console.log("\n[3] md 一直 in_progress → 3s 超时按成功");
plan.push({ search: "in_progress" });
let t0 = Date.now();
res = await ask(md());
let took = Date.now() - t0;
ok(res.done === 1 && res.failed.length === 0, "超时按成功，不误报");
ok(took >= 3000, `耗时 ${took}ms ≥ 3000ms（有界等待确实发生了）`);

console.log("\n[4] 大图不进等待路径");
plan.push({ search: "in_progress" }); // 若误入等待路径会卡满 3 秒
t0 = Date.now();
res = await ask({ type: "downloadFiles", data: { files: [{ filename: "images/a.jpg", url: "https://cdn.test/a.jpg" }] } });
took = Date.now() - t0;
ok(took < 100, `大图耗时 ${took}ms < 100ms`);
ok(res.done === 1 && res.failed.length === 0, "大图照常计成功");

console.log("\n[5] comments.json 也走等待，且事件一到就收尾");
plan.push({ search: "in_progress", emit: { state: "complete", after: 30 } });
t0 = Date.now();
res = await ask({ type: "downloadFiles", data: { files: [{ filename: "标题/a-comments.json", text: "[]", mime: "application/json" }] } });
took = Date.now() - t0;
ok(res.done === 1 && res.failed.length === 0, "onChanged complete → 成功");
ok(took >= 20 && took < 3000, `耗时 ${took}ms：等到了事件，没等满超时`);

console.log("\n[6] 事件路径：search 报 in_progress，18ms 后 interrupted");
plan.push({ search: "in_progress", emit: { state: "interrupted", error: "FILE_NO_SPACE", after: 18 } });
t0 = Date.now();
res = await ask(md());
took = Date.now() - t0;
ok(res.failed.length === 1 && res.failed[0].error === "FILE_NO_SPACE", "onChanged 的 error code 原样透传");
ok(took < 1000, `耗时 ${took}ms：事件到了就收尾，没等满 3 秒`);

console.log("\n[7] 同批多个文件互不牵连");
plan.push({ search: "complete" }, { search: "interrupted", error: "Invalid filename" }, { search: "complete" });
res = await ask({
  type: "downloadFiles",
  data: {
    files: [
      { filename: "a/1.md", text: "# 1", mime: "text/markdown" },
      { filename: "a/2.md", text: "# 2", mime: "text/markdown" },
      { filename: "a/3.md", text: "# 3", mime: "text/markdown" },
    ],
  },
});
ok(res.done === 2 && res.failed.length === 1, "2 成 1 败，逐条如实计数");
ok(res.failed[0].filename === "a/2.md", "失败的正是第 2 条");

console.log("\n[8] 3s 后才 interrupted：超时点的终局校验必须抓到");
plan.push({ searchSeq: ["in_progress", { state: "interrupted", error: "FILE_NO_SPACE" }] });
const t8 = Date.now();
const slow = await ask(md("标题/slow.md"));
const dt8 = Date.now() - t8;
ok(slow.failed.length === 1, "超时点查到 interrupted 时按失败报（改之前这里会报成功）");
ok(slow.failed[0] && slow.failed[0].error === "FILE_NO_SPACE", "error 原样透传：" + (slow.failed[0] || {}).error);
ok(slow.done === 0, "done 不计这条");
ok(dt8 >= 3000 && dt8 < 6000, `等待仍有界、没被拖长（实际 ${dt8}ms）`);

console.log(fails.length ? `\n✗ ${fails.length} 项未通过` : "\n✓ 全部通过");
if (fails.length) process.exit(1);
