import "./rn-format.js";

const DB_NAME = "keyval-store";
const STORE_NAME = "keyval";

/* 取消状态按任务（downloadId）分条，不再是一个模块级布尔：
 * 两个标签页同时保存时，一个收尾会把全局标志置回，正在跑的另一个被误判成「已取消」；
 * 而且 SW 随时被回收，模块变量清零，那个布尔的语义本来也不成立。
 * 只登记显式取消：没登记过的 id 一律当作「没取消」——
 * download 是 saveData 之后的独立消息，那时 saveData 的任务已注销，
 * 若把「查不到 = 已取消」，每一次保存都会在下载阶段静默变成 0 个文件。 */
const tasks = new Map();
const startTask = (id) => {
  if (id) tasks.set(id, { cancelled: false });
};
const endTask = (id) => {
  if (id) tasks.delete(id);
};
const isCancelled = (id) => !!(id && tasks.has(id) && tasks.get(id).cancelled);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useStore(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      const result = request && request.result;
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("IndexedDB transaction aborted"));
    };
  });
}

const putFiles = (key, files) => useStore("readwrite", (store) => store.put({ files }, key));
const getFiles = (key) => useStore("readonly", (store) => store.get(key));
/* 带 key 只删该任务的清单；不带 key 才整库清（content/index.js 发 clearData 时不带 id）。 */
const clearFiles = (key) => useStore("readwrite", (store) => (key ? store.delete(key) : store.clear()));

/* 文本文件走 base64 data URL。
 * 之前是 percent-encoding：中文一个字 3 字节 → 9 个字符，带 300 条评论的 md
 * 能撑到 MB 级 URL，而失败又只会落在下载器那边，正好丢掉最重要的 .md。 */
function dataUrl(file) {
  const bytes = new TextEncoder().encode(String(file.text || ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return "data:" + (file.mime || "text/plain") + ";base64," + btoa(binary);
}

/* 只有小文件（md / comments.json）等「确知写完了」再报成功：
 * chrome.downloads.download() 的 promise 在「下载条目建出来」时就 resolve，
 * 磁盘满、路径超长、权限不足这类失败会在之后异步变成 interrupted，光等 promise 看不见。
 * 视频/大图不等——那会把 SW 吊在一次长下载上，得不偿失。 */
const SETTLE_MIME = /^(?:text\/markdown|application\/json)\b/i;
const SETTLE_TIMEOUT = 3000;

function settleDownload(id, timeoutMs = SETTLE_TIMEOUT) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const onChanged = (delta) => {
      if (!delta || delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish({ ok: true });
      else if (delta.state.current === "interrupted") {
        finish({ ok: false, error: (delta.error && delta.error.current) || "interrupted" });
      }
    };
    /* 超时按成功算：宁可漏报，也不要把杀软扫尾这类慢收尾误报成失败。
     * 已知边界（下一轮补）：超时这一刻没有终局校验——下面那次 search 兜的是「事件早于监听
     * 落地」的竞态，不是「3s 之后才 interrupted」。所以 A2 按钮的「已提交」只能读作
     * 「本次没抓到失败证据」，不等于确认落盘；极慢收尾的 md/评论 json 失败会显示成已提交。
     * 修法不是放宽 timeout（downloadOne 逐文件 await，写盘卡死时按钮要愣更久、且逼近 SW 的
     * 30s 空闲回收），而是超时分支里补一次 downloads.search({id})，仍非 interrupted 才按 ok。
     * 补完也不 airtight：finish() 会摘监听，超时点查到 in_progress 之后就再也收不到 interrupted。 */
    timer = setTimeout(() => finish({ ok: true }), timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    /* data: URL 可能极快收尾，事件早于监听落地，补一次查询兜住这个竞态。 */
    Promise.resolve()
      .then(() => chrome.downloads.search({ id }))
      .then((items) => {
        const item = items && items[0];
        if (!item) return;
        if (item.state === "complete") finish({ ok: true });
        else if (item.state === "interrupted") finish({ ok: false, error: item.error || "interrupted" });
      })
      .catch(() => {});
  });
}

/* 相对路径长度闸门（不含下载根目录）：与下面 onChanged 的等待互补，不是替代——
 * onChanged 有 3s 上限，interrupted 晚于它就漏；这里是确定性的同步失败，快且不看时序。
 * 180 这个数：加 C:\Users\<name>\Downloads\ 约 40 字符仍在 220 以内，离 Windows 260 有富余。
 * 对 md 与媒体都生效——媒体名同样走 layout.mediaStem，长标题一样会撞。
 * 注：当前 rn-format 已把标题/作者截到 60/24 码点，生成名最长约 160，这层是兜底。 */
const MAX_RELATIVE_PATH = 180;

/* 单个媒体失效不阻断同篇笔记的正文与其余文件，但失败必须一路回传给调用方：
 * 以前这里只 console.warn 一句，UI 照样报「已保存」，
 * 结果是最该看到的东西（md 里的图链）指向一批并不存在的文件。 */
async function downloadOne(file) {
  const filename = String(file.filename || "");
  if (filename.length > MAX_RELATIVE_PATH) {
    return { ok: false, filename, error: "filename too long (" + filename.length + ")" };
  }
  let id;
  try {
    id = await chrome.downloads.download({
      filename,
      url: file.url || dataUrl(file),
      conflictAction: "overwrite",
    });
  } catch (error) {
    return { ok: false, filename, error: String((error && error.message) || error) };
  }
  if (!SETTLE_MIME.test(file.mime || "")) return { ok: true };
  const settled = await settleDownload(id);
  return settled.ok ? { ok: true } : { ok: false, filename, error: settled.error };
}

/* 返回 {done, failed:[{filename,error}], cancelled}。
 * 带 taskId 时每一轮都问一次是否已取消——用户点「取消」不该继续往下写盘。 */
async function downloadList(files, taskId) {
  let done = 0;
  const failed = [];
  for (const file of files || []) {
    if (taskId && isCancelled(taskId)) return { done, failed, cancelled: true };
    const result = await downloadOne(file);
    if (result.ok) done++;
    else failed.push({ filename: result.filename, error: result.error });
  }
  return { done, failed, cancelled: false };
}

function extractRawNote(noteId) {
  const state = window.__INITIAL_STATE__;
  const detailMap = state && state.note && state.note.noteDetailMap;
  const detail = detailMap && detailMap[noteId];
  return detail && detail.note;
}

async function runInPage(tab, func, noteId, opts = {}) {
  const tabId = tab && tab.id;
  if (!tabId) return undefined;
  const results = await chrome.scripting.executeScript({
    world: "MAIN",
    target: { tabId },
    func,
    args: [noteId, opts],
  });
  return results && results[0] && results[0].result;
}

async function extractNoteData(noteId, opts) {
  const escapeBrackets = (value) => String(value || "").replace(/\[([^[]{0,6})\]/g, "［$1］");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getDetail = () => {
    const state = window.__INITIAL_STATE__;
    const map = state && state.note && state.note.noteDetailMap;
    return map && map[noteId];
  };
  const getNote = () => {
    const detail = getDetail();
    return detail && detail.note;
  };
  const liveCount = () => {
    const note = getNote();
    const images = note && Array.isArray(note.imageList) ? note.imageList : [];
    return images.filter((image) => image && image.livePhoto).length;
  };

  function readDomVideos() {
    const videoUrl = (video) => {
      if (!video) return "";
      const source = video.querySelector("source");
      return video.currentSrc || video.src || (source && source.src) || "";
    };
    const valid = (url) => /^https?:/i.test(url) && /(\.mp4|sns-video|video)/i.test(url);
    const slideSelectors = [".media-container .swiper-slide", ".note-slider .swiper-slide", ".swiper-slide"];
    for (const selector of slideSelectors) {
      const slides = [...document.querySelectorAll(selector)];
      if (!slides.length) continue;
      const seen = new Set();
      const videos = [];
      slides.forEach((slide, index) => {
        const url = videoUrl(slide.querySelector("video"));
        if (!valid(url) || seen.has(url)) return;
        seen.add(url);
        const rawIndex = slide.dataset && slide.dataset.swiperSlideIndex;
        const order = rawIndex != null && rawIndex !== "" && !Number.isNaN(Number(rawIndex)) ? Number(rawIndex) : index;
        videos.push({ src: url, order });
      });
      if (videos.length) return videos.sort((a, b) => a.order - b.order);
    }
    for (const selector of [".media-container video", ".note-container video", "#noteContainer video"]) {
      const seen = new Set();
      const videos = [];
      [...document.querySelectorAll(selector)].forEach((video, index) => {
        const url = videoUrl(video);
        if (!valid(url) || seen.has(url)) return;
        seen.add(url);
        videos.push({ src: url, order: index });
      });
      if (videos.length) return videos;
    }
    return [];
  }

  function findLiveUrl(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    if (typeof value.masterUrl === "string" && value.masterUrl) return value.masterUrl;
    if (Array.isArray(value.backupUrls) && value.backupUrls[0]) return value.backupUrls[0];
    for (const key of Object.keys(value)) {
      const url = findLiveUrl(value[key], seen);
      if (url) return url;
    }
    return "";
  }

  function readImage(item) {
    if (!item) return { imageUrl: "", width: 0, livePhoto: "" };
    const infoList = Array.isArray(item.infoList) ? item.infoList : [];
    let imageUrl = item.url || "";
    const byScene = (scene) => {
      if (!scene) {
        const first = infoList[0];
        return typeof first === "string" ? first : (first && first.url) || "";
      }
      const match = infoList.find((info) => info && info.imageScene === scene);
      return (match && match.url) || "";
    };
    for (const scene of ["FD_PRV_WEBP", "CRD_PRV_WEBP", "FD_WM_WEBP", "CRD_WM_WEBP", ""]) {
      if (imageUrl) break;
      imageUrl = byScene(scene);
    }
    let livePhoto = typeof item.livePhoto === "string" ? item.livePhoto : findLiveUrl(item.livePhoto);
    if (!livePhoto && item.livePhoto) livePhoto = findLiveUrl(item.stream);
    return { imageUrl, width: item.width, livePhoto };
  }

  function bestVideo(note) {
    const stream = note && note.video && note.video.media && note.video.media.stream;
    let url = "";
    let bestPixels = -1;
    let bestRank = -1;
    for (const codec of Object.keys(stream || {})) {
      const options = stream[codec];
      if (!Array.isArray(options)) continue;
      for (const item of options) {
        if (!item) continue;
        const candidate = item.masterUrl || (Array.isArray(item.backupUrls) && item.backupUrls[0]) || "";
        if (!candidate) continue;
        const pixels = (Number(item.width) || 0) * (Number(item.height) || 0);
        const rank = Number(item.avgBitrate) || Number(item.videoBitrate) || Number(item.bitrate) || Number(item.size) || 0;
        if (pixels > bestPixels || (pixels === bestPixels && rank > bestRank)) {
          url = candidate;
          bestPixels = pixels;
          bestRank = rank;
        }
      }
    }
    return url;
  }

  let domVideos = [];
  try {
    domVideos = readDomVideos();
    const note = getNote();
    if (note && (note.type || "normal") !== "video" && domVideos.length && !liveCount()) {
      // 实况数据由页面异步补进 INITIAL_STATE，短暂等待比过早退回普通图片更可靠。
      for (let retry = 0; retry < 8; retry++) {
        await sleep(250);
        if (liveCount()) break;
        domVideos = readDomVideos();
      }
    }
  } catch (error) {
    // DOM 兜底失败不应影响 INITIAL_STATE 中已有的图文数据。
  }

  const detail = getDetail();
  const note = detail && detail.note;
  if (!note) return undefined;

  const noteType = note.type || "normal";
  const images = (Array.isArray(note.imageList) ? note.imageList : []).map(readImage).filter((image) => Number(image.width) > 0);
  const files = [];
  const useDom = noteType !== "video" && images.length > 0 && images.every((image) => !image.livePhoto) && domVideos.length === images.length;
  images.forEach((image, index) => {
    files.push({ path: image.imageUrl, width: image.width, type: "note", video: false });
    if (image.livePhoto) files.push({ path: image.livePhoto, width: 0, type: "note", video: true });
    else if (useDom) files.push({ path: domVideos[index].src, width: 0, type: "note", video: true });
  });

  if (noteType === "video") {
    const url = bestVideo(note);
    if (url) files.push({ path: url, width: 0, type: "note", video: true });
  }
  files.forEach((file, index) => {
    file.id = noteId + "_" + index;
  });

  const comments = [];
  if (opts.withComment) {
    const source = (detail.comments && detail.comments.list) || (note.comments && note.comments.list) || [];
    const readComment = (comment, withReplies, root) => {
      const user = comment.userInfo || {};
      const rootId = root == null ? comment.id : root;
      const pictures = [];
      (comment.pictures || []).forEach((picture, index) => {
        const image = readImage({ infoList: picture.infoList });
        if (!image.imageUrl) return;
        const file = { path: image.imageUrl, width: image.width, type: "comment", id: comment.id + "_" + index, root: rootId, video: false };
        files.push(file);
        pictures.push(file);
      });
      return {
        createTime: comment.createTime,
        content: escapeBrackets(comment.content),
        id: comment.id,
        ipLocation: comment.ipLocation || "",
        likeCount: comment.likeCount,
        pictures,
        user: { id: user.userId, username: user.nickname },
        subComments: withReplies ? (comment.subComments || []).map((reply) => readComment(reply, false, rootId)) : [],
      };
    };
    for (const comment of source) comments.push(readComment(comment, true));
  }

  if (opts.skipMedia && noteType !== "video") {
    files.length = 0;
    for (const comment of comments) {
      comment.pictures.length = 0;
      for (const reply of comment.subComments || []) reply.pictures.length = 0;
    }
  }

  return {
    noteTitle: note.title,
    noteCreateDate: note.time || note.lastUpdateTime || Date.now(),
    noteUser: note.user ? { id: note.user.userId, username: note.user.nickname } : null,
    noteTags: (note.tagList || []).map((tag) => tag.name),
    noteType,
    noteContent: escapeBrackets(note.desc),
    noteImageList: files,
    noteId,
    noteComments: comments,
  };
}

function inferExtension(url) {
  if (url.includes("jpeg")) return ".jpg";
  if (url.includes("jpg")) return ".jpg";
  if (url.includes("webp")) return ".webp";
  if (url.includes("mp4")) return ".mp4";
  if (url.includes("png")) return ".png";
  return ".jpg";
}

function normalizeMediaUrl(value, options = {}) {
  try {
    let url = String(value || "");
    const cdnIndex = url.indexOf("sns-webpic-qc.xhscdn.com/");
    if (cdnIndex >= 0) {
      let end = url.indexOf("!");
      if (end <= cdnIndex) end = url.length;
      const parts = url.substring(cdnIndex, end).split("/");
      parts.splice(0, 3);
      url = "https://sns-img-bd.xhscdn.com/" + parts.join("/");
      if (options.fileInfo && options.fileInfo.width) {
        url += "?imageView2/2/w/" + options.fileInfo.width + "/format/jpg";
      }
    }
    return /^http:\/\/(sns-[a-z0-9-]+\.xhscdn\.com\/)/i.test(url) ? "https://" + url.substring(7) : url;
  } catch (error) {
    return value;
  }
}

function commentTime(value) {
  const date = new Date(value);
  return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " +
    date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
}

/* 评论区格式与三站共用 RN.commentsMarkdown：一条一级评论一个有序列表项，
 * 作者头像/主页链接/IP 归属这些站内信息不进正文——它们没法在纯 markdown 里体面地表达，
 * 硬写成 <a>/<small> 只会在编辑器里变成一坨标签。IP 归属并进时间，和什么值得买一致。
 * 评论配图仍然入清单，引用挂在文字后面，不丢内容。 */
function appendComments(body, note, files, filePaths, layout) {
  const contentOf = (item) => {
    let text = String((item && item.content) || "").replace(/\s*\n\s*/g, " ").trim();
    const pictures = ((item && item.pictures) || [])
      .map((picture) => filePaths[picture.id])
      .filter(Boolean)
      .map((path) => `![](${globalThis.__RN.rel(path)})`);
    if (pictures.length) text = [text, pictures.join(" ")].filter(Boolean).join(" ");
    return text;
  };
  const timeOf = (item) => {
    const stamp = commentTime(item.createTime);
    return item.ipLocation ? stamp + " · " + item.ipLocation : stamp;
  };
  const toComment = (item) => ({
    author: (item.user && item.user.username) || "匿名",
    time: timeOf(item),
    text: contentOf(item),
    replies: (item.subComments || []).map((reply) => ({
      author: (reply.user && reply.user.username) || "匿名",
      time: timeOf(reply),
      text: contentOf(reply),
    })),
  });

  const section = globalThis.__RN.commentsMarkdown((note.comments || []).map(toComment));
  if (!section) return body;

  const path = layout.mediaStem + "-comments.json";
  files.push({ filename: layout.comments, text: JSON.stringify(note.comments), mime: "application/json" });
  return body + "\n\n" + section + `\n\n[评论](${globalThis.__RN.rel(path)})\n`;
}

async function assembleAndStore(downloadId, note, options) {
  if (!options.rnOnly || isCancelled(downloadId)) return;
  const RN = globalThis.__RN;
  const rawTitle = note.rawTitle || "";
  const nick = (note.user && note.user.username) || "";
  const timeMs = note.createDate || Date.now();
  const layout = RN.layout(rawTitle, nick, timeMs);

  let content = note.content || "";
  for (const tag of note.tags || []) {
    content = content.replaceAll(`#${tag}[话题]#`, "").replaceAll(`#${tag}［话题］#`, "");
  }
  let body = "# " + (rawTitle.trim() || "未命名文件") + "\n\n" + content + "\n";
  const files = [];
  const filePaths = Object.create(null);
  const commentRoots = Object.create(null);
  (note.comments || []).forEach((comment, index) => {
    if (comment && comment.id) commentRoots[comment.id] = index + 1;
  });
  let bodyIndex = 0;
  let imageIndex = 0;
  let videoIndex = 0;
  let commentImageIndex = 0;

  for (const file of note.fileInfos) {
    const source = file.fileUrl && file.fileUrl.url ? file.fileUrl.url : file.fileUrl;
    if (/^(blob|data):/i.test(source || "")) continue;
    const url = normalizeMediaUrl(source, { fileInfo: file });
    const video = !!file.video || /\.(?:mp4|mov|m4v)(\?|$)/i.test(url);
    const extension = video ? ".mp4" : (/(?:format\/jpg|\.jpe?g)/i.test(url) ? ".jpg" : inferExtension(url));
    const isComment = file.type === "comment";
    let path;
    if (isComment) {
      const root = commentRoots[file.root] || 0;
      path = RN.commentPath(layout.mediaStem, root, ++commentImageIndex, extension);
    } else {
      path = video
        ? RN.mediaPath(layout.mediaStem, ++videoIndex, extension, true)
        : RN.mediaPath(layout.mediaStem, ++imageIndex, extension);
      body += `\n![${++bodyIndex}](${RN.rel(path)})\n`;
    }
    if (file.id) filePaths[file.id] = path;
    files.push({ filename: layout.prefix + path, url });
  }

  if (options.withComment && note.comments && note.comments.length) {
    body = appendComments(body, note, files, filePaths, layout);
  }

  // 用户可能在 MAIN 世界取数或组装期间取消，取消后绝不留下可下载清单。
  if (isCancelled(downloadId)) return;
  const markdown = RN.frontmatter({
    title: rawTitle,
    nick,
    timeMs,
    type: note.noteType,
    counts: { images: imageIndex, videos: videoIndex },
    noteId: note.noteId,
    tags: note.tags,
  }) + "\n\n" + body.replace(/\n+$/, "") + "\n";
  files.push({ filename: layout.md, text: markdown, mime: "text/markdown" });
  await putFiles(downloadId + ":rn", files);
}

async function saveData(tab, downloadId, options) {
  const raw = await runInPage(tab, extractNoteData, downloadId, options);
  if (!raw || isCancelled(downloadId)) return;
  const note = {
    rawTitle: raw.noteTitle || "",
    createDate: raw.noteCreateDate,
    user: raw.noteUser,
    tags: raw.noteTags,
    content: raw.noteContent,
    noteId: raw.noteId,
    noteType: raw.noteType,
    comments: raw.noteComments,
    fileInfos: (raw.noteImageList || []).map((file) => ({
      ...file,
      fileUrl: file.path,
      video: !!file.video,
    })),
  };
  if (options.videoUrl) {
    const video = note.fileInfos.find((file) => file.video);
    if (video) video.fileUrl = options.videoUrl;
  }
  await assembleAndStore(downloadId, note, {
    withComment: !!options.withComment,
    rnOnly: !!options.rnOnly,
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "cancel": {
        /* content/index.js 发 cancel 时不带 downloadId，必须保留「全部任务取消」的语义；
         * 带 id 时只取消那一条，两个标签页互不牵连。 */
        const id = message.data && message.data.downloadId;
        if (id) {
          const task = tasks.get(id);
          if (task) task.cancelled = true;
        } else {
          tasks.forEach((task) => {
            task.cancelled = true;
          });
        }
        return undefined;
      }
      case "getNote":
        return runInPage(sender.tab, extractRawNote, message.downloadId);
      case "saveData":
        startTask(message.downloadId);
        try {
          await saveData(sender.tab, message.downloadId, message);
        } finally {
          endTask(message.downloadId);
        }
        return undefined;
      case "download": {
        /* download 是 saveData 之后的独立消息，这里重新登记任务，
         * 用户在这期间点取消才能被 downloadList 感知到。 */
        startTask(message.downloadId);
        try {
          const data = await getFiles(message.downloadId + ":rn");
          return await downloadList(data && data.files, message.downloadId);
        } finally {
          endTask(message.downloadId);
        }
      }
      /* downloadFiles / downloadUrl 不带 taskId，因此返回里的 cancelled 恒为 false：
       * 这两条消息来自没有取消入口的页面（豆瓣/微博/少数派/下厨房/值得买/Discuz/公众号），
       * 消息里也没有 downloadId 可以挂任务，硬接只会造出一个永远不成立的钩子。
       * 若将来某页要加取消：调用时在 message.data 里带上 downloadId，
       * 这里换成 startTask(downloadId) / downloadList(files, downloadId) / finally endTask 即可。 */
      case "downloadFiles": {
        const files = message.data && message.data.files || [];
        return downloadList(files);
      }
      case "downloadUrl": {
        const data = message.data || {};
        const files = [{ filename: data.filename, url: data.url }];
        if (data.md && data.mdFilename) {
          files.push({ filename: data.mdFilename, text: data.md, mime: "text/markdown" });
        }
        return downloadList(files);
      }
      case "fetchMedia": {
        /* 图床只认页面 Referer 时，内容脚本的 fetch 既被 CORS 拦、带不了来源，
         * 而这里（带 host 权限 + rules/douban-referer.json / rules/weibo-referer.json
         * 补 Referer）能拿到 200。取回字节再交给内容脚本拼 data: URL，绕开跨域读取限制。
         *
         * error 串是对 content/ 的公开契约，会原样写进 md 尾注与状态栏，改动前先通知对侧：
         *   missing url / unsupported scheme / HTTP <status> / not image: <content-type> /
         *   too large / timeout / <底层异常 message>
         * 一律短、英文、可直接展示；要中文化请在 content 侧映射，别改这里的字面量。 */
        const url = message.data && message.data.url;
        if (!url) return { ok: false, error: "missing url" };
        if (!/^https?:/i.test(url)) return { ok: false, error: "unsupported scheme" };
        const MAX_BYTES = 15 * 1024 * 1024;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return { ok: false, error: "HTTP " + response.status };
          /* 图床 200 也可能回一张 HTML 错误页/验证页，类型不对就不往下走，
           * 否则 base64 出来的是网页，存成 .png 一张都打不开。 */
          const type = response.headers.get("content-type") || "";
          if (!/^image\//i.test(type)) return { ok: false, error: "not image: " + (type || "(none)") };
          if (Number(response.headers.get("content-length")) > MAX_BYTES) return { ok: false, error: "too large" };
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > MAX_BYTES) return { ok: false, error: "too large" };
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          }
          return { ok: true, type, base64: btoa(binary) };
        } catch (error) {
          if (error && error.name === "AbortError") return { ok: false, error: "timeout" };
          return { ok: false, error: String((error && error.message) || error) };
        } finally {
          clearTimeout(timer);
        }
      }
      case "clearData":
        await clearFiles(message.downloadId ? message.downloadId + ":rn" : null);
        return undefined;
      default:
        return false;
    }
  })().then(sendResponse, (error) => sendResponse({ error: String(error && error.message || error) }));
  return true;
});

/* 图床放行规则走静态声明（manifest 的 declarative_net_request → rules/douban-referer.json、
 * rules/weibo-referer.json），不在这里动态注册：静态规则在扩展加载时就生效，不依赖 service worker 被唤醒。
 * 只补 Referer 请求头，不试图改响应头绕 CORS —— 实测改响应头对页面内 fetch 的 CORS 检查无效，
 * 但补 Referer 后后台 fetch 能直接 200，所以字节统一由 background 代取。 */
