import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const values = new Map();
const downloads = [];
let listener;
let databaseReady = false;
let extractionGate = null;

const db = {
  objectStoreNames: { contains: () => databaseReady },
  createObjectStore() { databaseReady = true; },
  close() {},
  transaction() {
    const transaction = {};
    transaction.objectStore = () => ({
      put(value, key) {
        values.set(key, value);
        return { result: undefined };
      },
      get(key) {
        return { get result() { return values.get(key); } };
      },
      clear() {
        values.clear();
        return { result: undefined };
      },
    });
    setTimeout(() => transaction.oncomplete && transaction.oncomplete(), 0);
    return transaction;
  },
};

globalThis.indexedDB = {
  open() {
    const request = { result: db };
    setTimeout(() => {
      if (!databaseReady && request.onupgradeneeded) request.onupgradeneeded();
      if (request.onsuccess) request.onsuccess();
    }, 0);
    return request;
  },
};

globalThis.location = { origin: "https://www.xiaohongshu.com", pathname: "/explore/note1" };
globalThis.document = { querySelectorAll: () => [] };
globalThis.window = { __INITIAL_STATE__: null };
globalThis.chrome = {
  runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
  },
  scripting: {
    async executeScript({ func, args }) {
      if (extractionGate) await extractionGate;
      return [{ result: await func(...args) }];
    },
  },
  downloads: {
    async download(options) {
      downloads.push(options);
      return downloads.length;
    },
  },
};

await import(pathToFileURL(path.join(ROOT, "js/background.js")).href);

function route(message) {
  return new Promise((resolve) => {
    const keepOpen = listener(message, { tab: { id: 7 } }, resolve);
    assert.equal(keepOpen, true, "消息通道必须保持打开");
  });
}

function setState(note, comments = []) {
  window.__INITIAL_STATE__ = {
    note: { noteDetailMap: { note1: { note, comments: { list: comments } } } },
    feed: { feeds: { _rawValue: [] } },
  };
}

const baseNote = {
  title: "标题",
  desc: "正文 #tag[话题]#",
  time: 1762000000000,
  type: "normal",
  user: { userId: "author", nickname: "作者" },
  tagList: [{ name: "tag" }],
  imageList: [
    { url: "http://sns-img-qc.xhscdn.com/a.webp", width: 100 },
    { infoList: [{ imageScene: "FD_PRV_WEBP", url: "https://sns-webpic-qc.xhscdn.com/spectrum/1000/b!x" }], width: 200 },
  ],
};
const comments = [{
  id: "comment1",
  content: "评论[赞]",
  createTime: 1762000001000,
  ipLocation: "上海",
  userInfo: { userId: "reader", nickname: "读者" },
  pictures: [{ infoList: [{ imageScene: "FD_PRV_WEBP", url: "https://cdn.test/comment.png" }] }],
  subComments: [],
}];

setState(baseNote, comments);
const raw = await route({ type: "getNote", downloadId: "note1" });
assert.equal(raw.title, "标题");

await route({ type: "clearData" });
await route({ type: "saveData", downloadId: "note1", withComment: true, rnOnly: true });
const withComments = values.get("note1:rn").files;
const media = withComments.filter((file) => file.url);
const markdownFile = withComments.find((file) => file.mime === "text/markdown");
assert.equal(media.length, 3, "两张笔记图和一张评论图都应入清单");
assert.equal((markdownFile.text.match(/!\[\d+\]/g) || []).length, 2, "正文媒体引用数必须等于笔记媒体数");
assert.ok(markdownFile.text.includes("\n类型: 图文\n"), "只有图时类型是「图文」");
assert.ok(withComments.some((file) => file.filename.endsWith("-comments.json")), "评论 JSON 必须入清单");
assert.ok(markdownFile.filename.startsWith("作者/标题/"), "目录必须沿用 RN 命名");
// 评论区必须是二级标题：与三站 RN.commentsMarkdown 的产物同构。
// 只断言 includes("# 评论") 对 "## 评论" 也成立，拦不住层级漂移，所以按行锚定。
assert.ok(markdownFile.text.includes("\n## 评论\n"), "评论区应为二级标题");
assert.ok(!/^# 评论$/m.test(markdownFile.text), "评论区不得退回一级标题");
// 3.3：评论里不能再出现行内 HTML。<a href>/<small title> 在 md 编辑器里就是一坨标签，
// 另外三站用的是 RN.commentsMarkdown，小红书也必须是同一个形状。
assert.ok(!/<(?:a|small|span|div|b|i)\b/i.test(markdownFile.text), "评论不得含行内 HTML 标签");
assert.ok(
  /^1\. \*\*读者\*\* · \d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2} · 上海$/m.test(markdownFile.text),
  "评论应为「1. **作者** · 时间 · IP」的有序列表项"
);
assert.ok(
  /^ {3}.*!\[\]\(\.\/.*-3\.png\)$/m.test(markdownFile.text),
  "评论配图挂在正文下方，用相对路径引用"
);
assert.ok(!markdownFile.text.includes("#tag[话题]#"), "话题标记应从正文删除");
assert.ok(media[1].url.startsWith("https://sns-img-bd.xhscdn.com/b?imageView2/2/w/200/format/jpg"));

downloads.length = 0;
await route({ type: "download", downloadId: "note1" });
assert.equal(downloads.length, withComments.length, "download 必须下发完整暂存清单");
assert.ok(downloads.every((file) => file.conflictAction === "overwrite"));

await route({ type: "saveData", downloadId: "note1", rnOnly: true, skipMedia: true });
const textOnly = values.get("note1:rn").files;
assert.equal(textOnly.length, 1, "skipMedia 只保留 Markdown");
assert.ok(!textOnly[0].text.includes("![1]"), "skipMedia 的 Markdown 不得引用媒体");

const videoNote = {
  ...baseNote,
  type: "video",
  imageList: [],
  video: {
    media: {
      stream: {
        h264: [
          { masterUrl: "https://cdn.test/720.mp4", width: 720, height: 960, avgBitrate: 900 },
          { masterUrl: "https://cdn.test/1440.mp4", width: 1440, height: 1920, avgBitrate: 6000 },
        ],
      },
    },
  },
};
setState(videoNote);
await route({ type: "saveData", downloadId: "note1", rnOnly: true });
assert.equal(values.get("note1:rn").files[0].url, "https://cdn.test/1440.mp4", "缺省选面积最大档");
await route({ type: "saveData", downloadId: "note1", rnOnly: true, videoUrl: "https://cdn.test/720.mp4" });
assert.equal(values.get("note1:rn").files[0].url, "https://cdn.test/720.mp4", "面板档位必须覆盖后台默认档");

downloads.length = 0;
await route({
  type: "downloadUrl",
  data: { url: "https://cdn.test/origin.mp4", filename: "作者/标题/a.mp4", mdFilename: "作者/标题/a.md", md: "# 标题" },
});
assert.equal(downloads.length, 2, "原视频与 Markdown 应依次下载");
assert.ok(downloads[1].url.startsWith("data:text/markdown;charset=utf-8,"));

assert.equal(await route({ type: "downloadFiles", data: { files: [{ url: "https://cdn.test/a.jpg", filename: "a.jpg" }] } }), 1);

setState(baseNote);
await route({ type: "clearData" });
let release;
extractionGate = new Promise((resolve) => { release = resolve; });
const pending = route({ type: "saveData", downloadId: "note1", rnOnly: true });
await new Promise((resolve) => setTimeout(resolve, 0));
await route({ type: "cancel" });
release();
await pending;
extractionGate = null;
assert.equal(values.has("note1:rn"), false, "取消后不得写入暂存清单");

/* 标题带空格时，文件名也带空格，md 里的引用必须转义成 %20。
 * 这是「图片没排进去」的成因：CommonMark 的链接目标遇到空格就截断，整行原样显示成文字。 */
setState({ ...baseNote, title: "标题 带 空格" });
await route({ type: "clearData" });
await route({ type: "saveData", downloadId: "note1", rnOnly: true });
const spaced = values.get("note1:rn").files.find((file) => file.mime === "text/markdown").text;
const imageLines = spaced.split("\n").filter((line) => line.startsWith("!["));
assert.equal(imageLines.length, 2, "两张图都要有引用");
assert.ok(imageLines.every((line) => !line.includes(" ")), "引用里不能留裸空格：" + imageLines[0]);
assert.ok(imageLines.every((line) => line.includes("标题%20带%20空格")), "空格应转成 %20：" + imageLines[0]);
assert.ok(decodeURIComponent(imageLines[0].slice(imageLines[0].indexOf("(") + 1, -1)).includes("标题 带 空格_作者-1."),
  "反转义要能还原成磁盘上的文件名");

console.log("✓ unit-xhs: 取数、组装、评论、清晰度、原视频、下载与取消全部通过");
