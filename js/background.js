import "./rn-format.js";

const DB_NAME = "keyval-store";
const STORE_NAME = "keyval";
let cancelled = true;

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
const clearFiles = () => useStore("readwrite", (store) => store.clear());

function dataUrl(file) {
  return "data:" + (file.mime || "text/plain") + ";charset=utf-8," + encodeURIComponent(file.text || "");
}

async function downloadOne(file) {
  try {
    await chrome.downloads.download({
      filename: file.filename,
      url: file.url || dataUrl(file),
      conflictAction: "overwrite",
    });
  } catch (error) {
    // 单个媒体失效不应阻断同篇笔记的正文和其余文件。
    console.warn("下载失败", file.filename, error);
  }
}

async function downloadList(files) {
  for (const file of files || []) await downloadOne(file);
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
  if (cancelled || !options.rnOnly) return;
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
  if (cancelled) return;
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
  if (cancelled || !raw) return;
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
      case "cancel":
        cancelled = true;
        return undefined;
      case "getNote":
        return runInPage(sender.tab, extractRawNote, message.downloadId);
      case "saveData":
        cancelled = false;
        try {
          await saveData(sender.tab, message.downloadId, message);
        } finally {
          cancelled = true;
        }
        return undefined;
      case "download": {
        const data = await getFiles(message.downloadId + ":rn");
        await downloadList(data && data.files);
        return undefined;
      }
      case "downloadFiles": {
        const files = message.data && message.data.files || [];
        await downloadList(files);
        return files.length;
      }
      case "downloadUrl": {
        const data = message.data || {};
        await downloadOne({ filename: data.filename, url: data.url });
        if (data.md && data.mdFilename) {
          await downloadOne({ filename: data.mdFilename, text: data.md, mime: "text/markdown" });
        }
        return undefined;
      }
      case "fetchMedia": {
        /* 图床只认页面 Referer 时，内容脚本的 fetch 既被 CORS 拦、带不了来源，
         * 而这里（带 host 权限 + rules/media-referer.json 补 Referer）能拿到 200。
         * 取回字节再交给内容脚本拼 data: URL，绕开跨域读取限制。 */
        const url = message.data && message.data.url;
        if (!url) return { ok: false, error: "missing url" };
        const response = await fetch(url);
        if (!response.ok) return { ok: false, error: "HTTP " + response.status };
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return {
          ok: true,
          type: response.headers.get("content-type") || "image/png",
          base64: btoa(binary),
        };
      }
      case "clearData":
        await clearFiles();
        return undefined;
      default:
        return false;
    }
  })().then(sendResponse, (error) => sendResponse({ error: String(error && error.message || error) }));
  return true;
});

/* 图床放行规则走静态声明（manifest 的 declarative_net_request → rules/media-referer.json），
 * 不在这里动态注册：静态规则在扩展加载时就生效，不依赖 service worker 被唤醒。
 * 只补 Referer 请求头，不试图改响应头绕 CORS —— 实测改响应头对页面内 fetch 的 CORS 检查无效，
 * 但补 Referer 后后台 fetch 能直接 200，所以字节统一由 background 代取。 */
