/* 什么值得买（post.smzdm.com）适配
 *
 * 结构要点（2026-11 实测，post/a4qpgkgx）：
 *   标题   article#articleId > h1.item-name（内含 <span class="edit_interface"> 要剔掉）
 *   作者   meta[property="article:author"]
 *          —— 不能用 .display-nickname：那是**评论**作者，整页出现 40 次
 *   时间   meta[property="article:published_time"]，形如 2026-10-31T12:33:28+08:00
 *   正文   article#articleId 本身（h1 / .recommend-tab 也在里面，遍历时跳过）
 *   图片   <a href="…/pic_N/"><img src="https://am.zdmimg.com/…/xxx.png_e1080.jpg">
 *          尾部 _e1080.jpg 是**服务端处理指令**，不是真实扩展名
 *
 * 图片只有站方两档，没有原图：
 *   xxx.png_e1080.jpg  → 200  image/png   697 KB（最大档）
 *   xxx.png_fo710.jpg  → 200  image/png   284 KB
 *   xxx.png            → 403              ← 裸地址不对外
 *   xxx.png_e2160.jpg  → 403
 *
 * 关键：真实 MIME 由「指令前面那段扩展名」决定，与尾部 .jpg 无关
 *   （xxx.png_* → image/png，xxx.jpg_* → image/jpeg，两档一致）。
 *   所以扩展名从源扩展名推，不用多发请求，也不会被 chrome.downloads 按 MIME 改名。
 *
 * 不需要 Referer（带不带都 200），因此不必像少数派那样「先抓后下」，
 * 直接把 URL 交给下载器即可。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const ARTICLE_RE = /^\/p\/([a-z0-9]+)/i;

  /* 尾部处理指令：.png_e1080.jpg / .jpg_fo710.jpg ……
   * 第 1 组是源扩展名，那才是文件真正的类型。 */
  const DIRECTIVE = /\.(jpe?g|png|gif|webp|avif|bmp)_(?:e\d+|fo\d+)\.(?:jpe?g|png|webp)$/i;

  /* 「全文完」装饰图、站点资源图不是文章配图 */
  const SKIP_IMG = /(?:^|\/)the-end\.(?:png|gif|jpe?g)$|res\.smzdm\.com/i;

  /* 要不要下图片；图片格式 big = 站方 1080 档，small = 710 档 */
  let media = true;
  let mode = "big";

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* ---------- 取数 ---------- */

  function meta(prop) {
    const el = document.querySelector('meta[property="' + prop + '"]');
    return el ? squash(el.getAttribute("content")) : "";
  }

  function titleOf() {
    const h1 = document.querySelector("article#articleId h1.item-name");
    if (!h1) return "";
    // .edit_interface 是站方的编辑入口占位，clone 后剔掉，别把它的空白算进标题
    const copy = h1.cloneNode(true);
    copy.querySelectorAll(".edit_interface").forEach((el) => el.remove());
    return squash(copy.textContent);
  }

  function sourceExt(url) {
    const path = url.split("?")[0].split("#")[0];
    const m = DIRECTIVE.exec(path);
    if (m) {
      const ext = m[1].toLowerCase();
      return ext === "jpeg" ? ".jpg" : "." + ext;
    }
    const tail = /\.([a-z0-9]{2,5})$/i.exec(path);
    const ext = tail ? tail[1].toLowerCase() : "jpg";
    return /^(jpe?g|png|gif|webp|avif|bmp)$/.test(ext) ? "." + ext : ".jpg";
  }

  function imageUrl(img) {
    const raw = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (!/^https?:\/\//i.test(raw)) return "";
    if (SKIP_IMG.test(raw)) return "";
    return raw;
  }

  /* 换档只动尾部指令，源扩展名保持不变 */
  function tierUrl(url, which) {
    const suffix = which === "small" ? "_fo710.jpg" : "_e1080.jpg";
    if (!DIRECTIVE.test(url.split("?")[0])) return url;
    return url.replace(DIRECTIVE, (_, ext) => "." + ext + suffix);
  }

  /* 正文走一趟，图片和视频在原位留占位符，保证 md 里顺序不乱。
   * media 里每项带 video 标记：图片走站方 1080/710 两档改写，视频是签名地址，原样下。 */
  function walkBody(root) {
    const parts = [];
    const media = [];
    const seen = new Set();

    const push = (text) => {
      if (text) parts.push(text);
    };

    const add = (url, video) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      media.push({ url, video: !!video });
      push((video ? "\n\u0000" : "\u0000") + (media.length - 1) + "\u0000" + (video ? "\n" : ""));
    };

    function visit(node) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, " ");
        if (t.trim()) push(t);
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "input") return;
      // 标题和日期/点赞那一行都在 article 里，但它们由别的字段负责
      if (tag === "h1") return;
      if (node.classList.contains("recommend-tab")) return;
      // 挂载点在部分页面会退化到 article 本身，别把我们自己的按钮和面板当正文抓走
      if (node.classList.contains("xhx-zdm-slot")) return;
      // 品牌合作声明是站方模板文案，不是作者内容
      if (node.classList.contains("interests_statement")) return;
      // 商品卡片是空壳（内容由 JS 异步注入），留个记号比静默丢掉好
      if (node.classList.contains("insert-card-editor")) {
        push("\n> 商品卡片（原文为站内嵌卡片，未抓取）\n");
        return;
      }

      if (tag === "img") {
        add(imageUrl(node), false);
        return;
      }
      /* 视频是站内嵌卡片：静态 HTML 里只有 video-id，播放器由 JS 注入。
       * 注入后是 <video class="haowen-video"><source src="https://sqcwsp-vod.smzdm.com/…mp4?sign=…">
       * 地址自带签名参数，直接交给下载器即可，不需要 Referer。 */
      if (tag === "video" || node.classList.contains("insert-video-card")) {
        const video = tag === "video" ? node : node.querySelector("video");
        const source = video && (video.currentSrc || (video.querySelector("source") || {}).src || video.src || "");
        if (source) add(source, true);
        else push("\n\n> 视频卡片（未取到播放地址，展开页面后重试）\n\n");
        return;
      }
      if (tag === "br") {
        push("\n");
        return;
      }
      if (tag === "hr") {
        push("\n\n---\n\n");
        return;
      }

      const block = /^(p|h[1-6]|li|blockquote|div|section|pre|table|tr|figure|figcaption)$/.test(tag);
      if (block) push("\n");
      if (tag === "h2") push("## ");
      else if (tag === "h3") push("### ");
      else if (tag === "h4") push("#### ");
      else if (tag === "li") push("- ");
      else if (tag === "blockquote") push("> ");
      else if (tag === "strong" || tag === "b") push("**");

      for (const child of node.childNodes) visit(child);

      if (tag === "strong" || tag === "b") push("**");
      if (block) push("\n");
    }

    visit(root);
    const text = parts
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, media };
  }

  function readArticle() {
    const idMatch = ARTICLE_RE.exec(location.pathname);
    const root = document.querySelector("article#articleId");
    if (!idMatch || !root) return null;

    const title = titleOf() || squash(document.title).replace(/\s*_\S+_什么值得买\s*$/, "");
    if (!title) return null;

    const nick = meta("article:author");
    const stamp = meta("article:published_time");
    const time = Number.isFinite(Date.parse(stamp)) ? Date.parse(stamp) : Date.now();

    const { text, media } = walkBody(root);

    return {
      id: idMatch[1],
      title,
      nick,
      time,
      body: text,
      media,
      url: "https://post.smzdm.com/p/" + idMatch[1] + "/",
    };
  }

  /* ---------- 评论 ---------- */

  /* 页面里有两个评论 tab：#commentTabBlockHot（精彩，默认显示）和
   * #commentTabBlockNew（最新，display:none）。两边都是服务端直出，
   * 全读会把同一批评论算两遍，所以只读当前可见的那个。
   *
   * 二级回复的容器 .comment-main-list-item-content-reply-container 在首屏是空的
   * （回复靠 AJAX 拉），快照里拿不到结构，这里就不猜——只存一级评论。 */
  const MAX_COMMENTS = 300;

  function commentRoot() {
    const blocks = [...document.querySelectorAll("#commentTabBlockHot, #commentTabBlockNew")];
    return blocks.find((el) => el.offsetParent !== null) || blocks[0] || null;
  }

  function commentAuthor(el) {
    return squash(el.querySelector(".comment-user-name")?.textContent);
  }

  /* .content-info 里是 <span>11-01 01:06</span><span>·</span><span>日本</span> */
  function commentTime(el) {
    const info = el.querySelector(".comment-main-list-item-content-info .content-info");
    if (!info) return "";
    return [...info.children]
      .map((x) => squash(x.textContent))
      .filter((x) => x && x !== "·")
      .join(" · ");
  }

  /* 表情是 <img class="wp-smiley" alt="[无语]">，textContent 读不到，先把 alt 换回文字 */
  function commentText(el) {
    const node = el.querySelector(".comment-main-list-item-content-comment");
    if (!node) return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("img").forEach((img) => {
      const alt = img.getAttribute("alt");
      if (alt) img.replaceWith(document.createTextNode(alt));
      else img.remove();
    });
    return squash(copy.textContent);
  }

  function readComments() {
    const root = commentRoot();
    if (!root) return [];
    return [...root.querySelectorAll(".comment-main-list-item")]
      .map((el) => ({ author: commentAuthor(el), time: commentTime(el), text: commentText(el) }))
      .filter((c) => c.text)
      .slice(0, MAX_COMMENTS);
  }

  /* ---------- 投递 ---------- */

  /* 图片两档都是公开地址，不需要 Referer，直接把 URL 交给下载器。
   * 文件名按源扩展名取，和 CDN 回的 Content-Type 一致，不会被 Chrome 改名。
   *
   * 视频不一样：地址是签名过的（?t=…&sign=…），而且是防盗链的。chrome.downloads
   * 发的是裸请求，站方回 403，落在下载栏里就是「没有权限，无法下载」。
   * 和少数派同一套解法——先在本页 fetch（带 Referer 和登录态）拿字节，
   * 再转 data: URL 交给下载器。抓不到就退回直链，并在 md 里写明原因，
   * 静默失败最难查。 */
  const BATCH = 10;
  const VIDEO_MAX = 48 * 1024 * 1024;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function grabVideo(url) {
    /* 手动超时而不是 AbortSignal.timeout：manifest 没锁最低内核版本。
     * 没有这一步时，一个半开连接会让「保存中」永久停住，按钮也永久 disabled。 */
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      /* omit 而不是 include：签名地址不靠 cookie，而带凭据的跨域请求要求 CDN 回具体源，
       * 很多视频域名只给 *，那样反而被 CORS 挡掉。Referer 无论哪种模式都会带。 */
      const res = await fetch(url, { credentials: "omit", signal: ctrl.signal });
      if (!res.ok) return { error: "HTTP " + res.status };
      const blob = await res.blob();
      if (!blob.size) return { error: "空响应" };
      if (blob.size > VIDEO_MAX) return { error: "体积 " + Math.round(blob.size / 1048576) + "MB 过大" };
      return { url: await blobToDataUrl(blob) };
    } catch (e) {
      return { error: e && e.name === "AbortError" ? "超时 15s" : "跨域被拒" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const withComments = !!options.withComments;
    const pick = options.mode === "small" ? "small" : "big";
    const layout = RN.layout(info.title, info.nick, info.time);
    const total = info.media.length;
    const names = new Array(total);
    const srcs = new Array(total);
    const failed = [];
    let imageIndex = 0;
    let videoIndex = 0;

    /* 一、先定名字。扩展名只看地址（_e1080/.png 这类），不必等字节回来。 */
    for (let j = 0; j < total; j++) {
      const item = info.media[j];
      /* 选了「跳过」就一个都不抓：names 全空，md 里按索引替换占位符时媒体整段消失 */
      if (!withMedia) break;
      names[j] = RN.mediaPath(
        layout.mediaStem,
        item.video ? ++videoIndex : ++imageIndex,
        item.video ? ".mp4" : sourceExt(item.url),
        item.video
      );
      /* 视频没有 1080/710 两档，地址是签名过的原始文件，改写只会把它弄坏 */
      srcs[j] = item.video ? "" : tierUrl(item.url, pick);
    }

    /* 二、视频先抓字节：数量少，而且签名地址是防盗链的，直链会被 403。 */
    for (let j = 0; j < total && withMedia; j++) {
      if (!info.media[j].video) continue;
      const got = await grabVideo(info.media[j].url);
      if (got.url) srcs[j] = got.url;
      else {
        srcs[j] = info.media[j].url;
        failed.push("第 " + (j + 1) + " 项 " + got.error);
      }
    }

    let body = info.body.replace(/\u0000(\d+)\u0000/g, (_, n) => {
      const name = names[Number(n)];
      return name ? `![${Number(n) + 1}](${RN.rel(name)})` : "";
    });

    if (failed.length) {
      body += "\n\n> 视频未能取到字节（" + failed.join("；") + "），已按原始地址交给浏览器下载；若下载栏提示没有权限，就是站方防盗链拦了裸请求。";
    }

    if (withComments) {
      const commentsText = RN.commentsMarkdown(readComments());
      if (commentsText) body += "\n\n" + commentsText;
    }

    const md = RN.markdown({
      source: "什么值得买",
      url: info.url,
      title: info.title,
      nick: info.nick,
      timeMs: info.time,
      type: "normal",
      counts: {
        images: total - info.media.filter((item) => item.video).length,
        videos: info.media.filter((item) => item.video).length,
      },
      noteId: info.id,
      desc: body,
      tags: [],
      media: [],
    });

    /* 三、md 先发。视频抓字节要几秒，媒体又是批量发的，md 放在最后就会出现
     * 「视频已经下来了、MD 还没来」，看着像 md 丢了。正文是主体，先落它。
     * 媒体那一步再出错也不该影响已经落地的 md，所以单独 try。 */
    const mdRes = await chrome.runtime.sendMessage({
      type: "downloadFiles",
      data: { files: [{ filename: layout.md, text: md, mime: "text/markdown" }] },
    });
    /* md 自己没落盘时不能写进 md（它根本没落盘，注记等于自欺），只能回传给 UI。
     * 判据与豆瓣/微博/少数派/下厨房一致：filename 精确比对，不看 failed 条数。 */
    const mdSaved = !(mdRes && mdRes.failed && mdRes.failed.some((f) => f && f.filename === layout.md));

    /* 四、再发媒体。 */
    const failedWrite = [];
    /* 端口断开（扩展重载、SW 崩溃）时 sendMessage 是 reject 而不是回 {failed}，
     * 循环被打断、剩下的批次一张没发，failedWrite 却是空的——必须单独记一笔，
     * 否则 UI 会显示「已提交」，用户以为 20/20 都发了。 */
    let mediaError = "";
    if (withMedia) {
      try {
        let done = 0;
        for (let i = 0; i < total; i += BATCH) {
          const batch = [];
          for (let j = i; j < Math.min(i + BATCH, total); j++) {
            if (!srcs[j]) continue;
            batch.push({ filename: layout.prefix + names[j], url: srcs[j] });
          }
          if (batch.length) {
            const wrote = await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: batch } });
            /* md 已经先落地了，这批失败补不进正文，只能交给 UI 交代条数。 */
            if (wrote && wrote.failed) failedWrite.push(...wrote.failed);
          }
          done += batch.length;
          if (onProgress) onProgress(done, total);
        }
      } catch (e) {
        mediaError = "媒体下发中断（md 已落地）";
        console.warn("小红虾 · 媒体下发中断（md 已落地）", e);
      }
      /* md 已先落地，这批失败补不进正文（改 md 就得把它挪到媒体之后，得不偿失），
       * 只留一条完整清单在控制台备查。 */
      if (failedWrite.length) console.warn("小红虾 · 媒体落盘失败（md 已落地，正文引用可能指向缺失文件）", failedWrite);
    }
    return { media: withMedia ? total : 0, md: layout.md, mdSaved, failedWrite, mediaError };
  }

  /* ---------- UI ---------- */

  let slot = null;
  let panel = null;
  let stateEl = null;
  let labelEl = null;
  let pinned = false;

  function setPinned(on) {
    pinned = !!on;
    if (slot) slot.classList.toggle("is-pinned", on);
  }

  function setOpen(on) {
    if (!slot) return;
    slot.classList.toggle("is-open", on);
    if (!on) setPinned(false);
  }

  function refreshCount() {
    if (!stateEl) return;
    const info = readArticle();
    if (!info) return;
    const total = info.media.length;
    const videos = info.media.filter((item) => item.video).length;
    if (labelEl) labelEl.textContent = videos ? "图片+视频" : "图片";
    stateEl.textContent = !total ? "无" : videos ? total + " 项" : total + " 张";
  }

  function paint() {
    if (!panel) return;
    for (const seg of panel.querySelectorAll(".xhx-zdm-seg")) {
      const cur = seg.dataset.group === "media" ? (media ? "1" : "0") : mode;
      for (const el of seg.querySelectorAll("button[data-value]")) {
        const on = el.dataset.value === cur;
        el.classList.toggle("is-on", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
  }

  function ensureUI() {
    if (slot) return;

    slot = document.createElement("div");
    slot.className = "xhx-zdm-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "xhx-zdm-entry";
    entry.title = "小红虾 · 保存这篇文章";
    entry.innerHTML =
      '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "xhx-zdm-panel";
    panel.innerHTML =
      '<div class="xhx-zdm-qhead"><span class="lbl">图片</span><span class="cnt"></span></div>' +
      '<div class="xhx-zdm-seg" data-group="media">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="xhx-zdm-seg" data-group="mode">' +
      '<button type="button" data-value="big">1080</button>' +
      '<button type="button" data-value="small">710</button>' +
      "</div>" +
      '<div class="xhx-zdm-actions">' +
      '<button type="button" class="xhx-zdm-act" data-comments="0">正文</button>' +
      '<button type="button" class="xhx-zdm-act is-ghost" data-comments="1">正文+回复</button>' +
      "</div>";

    slot.appendChild(entry);
    slot.appendChild(panel);

    stateEl = panel.querySelector(".xhx-zdm-qhead .cnt");
    labelEl = panel.querySelector(".xhx-zdm-qhead .lbl");

    /* 点胶囊＝按当前选择直接存（正文，不带回复），跟小红书一致。
     * 面板只靠悬停展开，点击不再开合——四个站里只有小红书一键下载，手感对不上。 */
    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const primary = panel.querySelector('.xhx-zdm-act[data-comments="0"]');
      if (primary && !primary.disabled) primary.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount();
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });

    for (const seg of panel.querySelectorAll(".xhx-zdm-seg")) {
      seg.addEventListener("click", (e) => {
        const el = e.target.closest("button[data-value]");
        if (!el) return;
        e.stopPropagation();
        if (seg.dataset.group === "media") media = el.dataset.value === "1";
        else mode = el.dataset.value;
        setPinned(true);
        paint();
      });
    }

    /* 两个动作＝存到哪儿为止，跟小红书、Chiphell 一致 */
    for (const act of panel.querySelectorAll(".xhx-zdm-act")) {
      act.addEventListener("click", async () => {
        const info = readArticle();
        if (!info || act.disabled) return;
        for (const b of panel.querySelectorAll(".xhx-zdm-act")) b.disabled = true;
        const label = act.textContent;
        const withMedia = media;
        /* 失败文案要停留久一点，900ms 眨眼就没；全成功仍是 900ms、文案逐字不变。 */
        let hold = 900;
        try {
          act.textContent = withMedia ? "0/" + info.media.length : "保存中";
          const result = await deliver(
            info,
            (done, total) => {
              act.textContent = done + "/" + total;
            },
            { mode, withMedia, withComments: act.dataset.comments === "1" }
          );
          const failedCount = (result && result.failedWrite && result.failedWrite.length) || 0;
          if (result && result.mdSaved === false) {
            act.textContent = "md 未保存";
            hold = 4000;
          } else if (result && result.mediaError) {
            /* 比「N 个未保存」重：整批没发出去，且失败的条数都数不出来。 */
            act.textContent = "媒体下发中断";
            hold = 4000;
          } else if (failedCount) {
            act.textContent = failedCount + " 个媒体未保存";
            hold = 4000;
          } else {
            act.textContent = "已提交";
          }
        } catch (e) {
          act.textContent = "失败";
        } finally {
          setTimeout(() => {
            for (const b of panel.querySelectorAll(".xhx-zdm-act")) b.disabled = false;
            act.textContent = label;
            setOpen(false);
          }, hold);
        }
      });
    }

    paint();
    refreshCount();
  }

  /* 日期/点赞/收藏/评论那一行右侧是空的，胶囊挂在那里 */
  function findAnchor() {
    return (
      document.querySelector("article#articleId .recommend-tab") ||
      document.querySelector("article#articleId")
    );
  }

  function tick() {
    if (!ARTICLE_RE.test(location.pathname)) return;
    const anchor = findAnchor();
    if (!anchor) return;
    ensureUI();
    if (slot.parentElement !== anchor) anchor.appendChild(slot);
  }

  document.addEventListener("click", (e) => {
    if (slot && !slot.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  tick();
  // 正文是服务端直出，不需要 MutationObserver；只在节点被冲掉时补挂
  setInterval(tick, 1500);
})();
