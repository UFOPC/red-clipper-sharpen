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
const picture = (url) => ({ infoList: [{ imageScene: "FD_PRV_WEBP", url }] });
const comments = [{
  id: "comment1",
  content: "评论[赞]",
  createTime: 1762000001000,
  ipLocation: "上海",
  userInfo: { userId: "reader", nickname: "读者" },
  pictures: [picture("https://cdn.test/comment-1.png")],
  subComments: [{
    id: "reply1",
    content: "二级回复",
    createTime: 1762000002000,
    userInfo: { userId: "replier", nickname: "回复者" },
    pictures: [picture("https://cdn.test/comment-2.png")],
    subComments: [],
  }],
}, {
  id: "comment2",
  content: "第二条一级评论",
  createTime: 1762000003000,
  userInfo: { userId: "reader2", nickname: "读者二" },
  pictures: [picture("https://cdn.test/comment-3.png")],
  subComments: [],
}];

setState(baseNote, comments);
const raw = await route({ type: "getNote", downloadId: "note1" });
assert.equal(raw.title, "标题");

await route({ type: "clearData" });
await route({ type: "saveData", downloadId: "note1", withComment: true, rnOnly: true });
const withComments = values.get("note1:rn").files;
const media = withComments.filter((file) => file.url);
const bodyMedia = media.filter((file) => /\/(?:images|media)\//.test(file.filename));
const commentMedia = media.filter((file) => file.filename.includes("/comments/"));
const markdownFile = withComments.find((file) => file.mime === "text/markdown");
assert.equal(media.length, 5, "两张正文图和三张评论图都应入清单");
assert.equal(bodyMedia.length, 2, "images/ 与 media/ 只收正文媒体");
assert.equal(commentMedia.length, 3, "comments/ 收全部一级、二级评论图");
assert.equal((markdownFile.text.match(/!\[\d+\]/g) || []).length, 2, "正文媒体引用数必须等于正文媒体文件数");
assert.ok(markdownFile.text.includes("\n类型: 图文\n"), "只有图时类型是「图文」");
assert.ok(withComments.some((file) => file.filename === "标题/2025.11.01_标题-comments.json"), "评论 JSON 必须落在标题目录根部");
assert.equal(markdownFile.filename, "标题/2025.11.01_标题_作者.md", "取消作者目录，MD 保留作者且不带额外结尾连字符");
assert.deepEqual(bodyMedia.map((file) => file.filename), [
  "标题/images/2025.11.01_标题-01.webp",
  "标题/images/2025.11.01_标题-02.jpg",
]);
assert.deepEqual(commentMedia.map((file) => file.filename), [
  "标题/comments/2025.11.01_标题-01-c1.png",
  "标题/comments/2025.11.01_标题-01-c2.png",
  "标题/comments/2025.11.01_标题-02-c3.png",
], "二级评论继承一级评论序号，cN 全局递增且不撞名");
assert.equal(new Set(commentMedia.map((file) => file.filename)).size, 3, "评论图路径必须唯一");
assert.ok(commentMedia.every((file) => !file.filename.includes("-00-")), "root 不得因 saveData 丢字段而落入 00 段");
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
  /^ {3}.*!\[\]\(\.\/comments\/2025\.11\.01_标题-01-c1\.png\)$/m.test(markdownFile.text),
  "一级评论配图挂在评论文字后，并引用 comments/ 下的真实路径"
);
assert.ok(
  markdownFile.text.includes("![](./comments/2025.11.01_标题-01-c2.png)"),
  "二级评论引用所属一级评论 01 段的全局第 2 张图"
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

setState({ ...videoNote, imageList: [baseNote.imageList[0]] });
await route({ type: "saveData", downloadId: "note1", rnOnly: true });
const mixed = values.get("note1:rn").files;
assert.deepEqual(mixed.filter((file) => file.url).map((file) => file.filename), [
  "标题/images/2025.11.01_标题-01.webp",
  "标题/media/2025.11.01_标题-01.mp4",
], "正文图片与视频分目录并各自从 01 编号");
const mixedMd = mixed.find((file) => file.mime === "text/markdown").text;
assert.equal((mixedMd.match(/!\[\d+\]/g) || []).length, 2, "一图一视频有两条正文引用");
assert.ok(mixedMd.includes("\n类型: 图文+视频\n"), "评论图不进入正文类型与媒体计数");

downloads.length = 0;
await route({
  type: "downloadUrl",
  data: { url: "https://cdn.test/origin.mp4", filename: "标题/media/a.mp4", mdFilename: "标题/a.md", md: "# 标题" },
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

/* 标题里的空白与半角/全角括号不得进入目录或文件名；MD 正文标题仍保留原文。 */
setState({ ...baseNote, title: "标题 （带） [空格]" });
await route({ type: "clearData" });
await route({ type: "saveData", downloadId: "note1", rnOnly: true });
const cleanedFiles = values.get("note1:rn").files;
const cleanedMd = cleanedFiles.find((file) => file.mime === "text/markdown");
const imageLines = cleanedMd.text.split("\n").filter((line) => line.startsWith("!["));
assert.equal(imageLines.length, 2, "两张图都要有引用");
assert.ok(imageLines.every((line) => !line.includes(" ")), "引用里不能留裸空格：" + imageLines[0]);
assert.ok(imageLines.every((line) => line.includes("images/2025.11.01_标题带空格-")), "标题应去掉空白与括号：" + imageLines[0]);
assert.ok(cleanedFiles.every((file) => file.filename.startsWith("标题带空格/")), "所有产物只落在清洗后的标题目录");
assert.equal(cleanedMd.filename, "标题带空格/2025.11.01_标题带空格_作者.md");
assert.ok(cleanedMd.text.includes("# 标题 （带） [空格]"), "清洗只作用于路径，不改 MD 里的原始标题");

/* 无标题笔记使用作者与发布日期兜底目录，不能散落下载根目录。 */
setState({ ...baseNote, title: "" });
await route({ type: "clearData" });
await route({ type: "saveData", downloadId: "note1", rnOnly: true });
const untitled = values.get("note1:rn").files;
assert.ok(untitled.every((file) => file.filename.startsWith("未命名文件_作者_2025.11.01/")), "无标题时所有产物进入带作者和日期的兜底目录");
assert.deepEqual(untitled.map((file) => file.filename), [
  "未命名文件_作者_2025.11.01/images/2025.11.01-01.webp",
  "未命名文件_作者_2025.11.01/images/2025.11.01-02.jpg",
  "未命名文件_作者_2025.11.01/2025.11.01_作者.md",
]);
assert.ok(untitled[2].text.includes("# 未命名文件"), "无标题时正文 H1 使用同一个兜底名");

console.log("✓ unit-xhs: 取数、组装、评论、清晰度、原视频、下载与取消全部通过");
