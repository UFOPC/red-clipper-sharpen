/* 少数派（sspai.com）适配
 *
 * 结构要点（2026-11 实测）：
 *   标题   h1#article-title
 *   作者   JSON-LD author.name，回落作者头像 img[alt]
 *   日期   .article__header__date 形如「2026年10月28日」
 *   正文   .article__main__content（wangEditor 容器），回落 .article-body
 *   挂载   普通文章用 .article__header__*；重要文章用右侧作者栏 .article__important__header__side
 *   图片   <figure class="image ss-img-wrapper"><img src="…w/1120…" data-original="…?imageView2/2/format/webp">
 *          data-original 带的是 CDN 转码指令，去掉才拿到作者上传的原文件；
 *          src 是站方在页面里实际提供的那份（1120 宽 + webp），体积更小
 *
 * 防盗链：cdnfile.sspai.com 对「没有 Referer 的裸请求」返回 403（响应体 170 字节）。
 * chrome.downloads.download 恰好就是这种裸请求，而且 declarativeNetRequest 的
 * modifyHeaders 对它完全无效（实测连自定义头都注不进去）——下载请求是浏览器进程
 * 直接发出的，不经过扩展能改写的那条链路。
 *
 * 所以走「先抓字节、再交下载器」：内容脚本 fetch（带着页面来源，200）→ blob →
 * data: URL → 后台照常 chrome.downloads.download。md 本来就是这么下的，路径嵌套也正常。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const ARTICLE_RE = /^\/post\/(\d+)/;
  /* 站方在页面里用的就是这一串，带 format/webp —— 实测这才是真的比原图小。
   * 去掉 format/webp 只是按宽度重编码，对本来就窄的图反而更大。 */
  const SMALL_Q = "imageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp";
  const SKIP_IMG = /img-placeholder|avatar|logo/i;
  const MAX_COMMENTS = 300;

  /* 要不要下图片；图片格式 origin = 作者上传的原文件，small = 站方 1120 压缩版 */
  let media = true;
  let mode = "origin";

  /* ---------- 取数 ---------- */

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function ldJson() {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(el.textContent);
        const node = Array.isArray(data) ? data[0] : data;
        if (node && node.headline) return node;
      } catch (e) {}
    }
    return null;
  }

  function parseDate(text) {
    const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text || "");
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const iso = Date.parse(text || "");
    return Number.isFinite(iso) ? iso : Date.now();
  }

  /* data-original 常带 ?imageView2/2/format/webp —— 那是 CDN 的转码指令，不是文件本身的一部分。
   * 去掉才拿到作者上传的原文件（实测 22.5KB 的真 jpeg，而不是 12KB 的 webp 转码版）。
   * 只剥 imageView2/ 开头的，别把其它签名类查询参数误伤。 */
  function imageUrl(img) {
    const raw = img.getAttribute("data-original") || img.currentSrc || img.src || "";
    if (!/^https?:\/\//i.test(raw)) return "";
    if (SKIP_IMG.test(raw)) return "";
    const cut = raw.indexOf("?");
    if (cut < 0) return raw;
    const query = raw.slice(cut + 1);
    return /^imageView2\//.test(query) ? raw.slice(0, cut) : raw;
  }

  function extOf(url) {
    const path = url.split("?")[0].split("#")[0];
    const m = /\.([a-z0-9]{2,5})$/i.exec(path);
    const ext = m ? m[1].toLowerCase() : "jpg";
    return /^(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(ext) ? "." + ext : ".jpg";
  }

  function smallUrl(origin) {
    return origin + (origin.includes("?") ? "&" : "?") + SMALL_Q;
  }

  /* 正文走一趟，图片在原位留占位符，保证 md 里图不乱序 */
  function walkBody(root) {
    const parts = [];
    const images = [];
    const seen = new Set();

    function push(text) {
      if (text) parts.push(text);
    }

    function visit(node) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, " ");
        if (t.trim()) push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;

      if (tag === "img") {
        const url = imageUrl(node);
        if (!url || seen.has(url)) return;
        seen.add(url);
        images.push(url);
        push("\u0000" + (images.length - 1) + "\u0000");
        return;
      }
      if (tag === "br") {
        push("\n");
        return;
      }

      const block = /^(p|h[1-6]|li|blockquote|figcaption|div|figure|section|pre|table|tr)$/.test(tag);
      if (block) push("\n");
      if (tag === "h2") push("## ");
      else if (tag === "h3") push("### ");
      else if (tag === "h4") push("#### ");
      else if (tag === "li") push("- ");
      else if (tag === "blockquote" || tag === "figcaption") push("> ");

      for (const child of node.childNodes) visit(child);
      if (block) push("\n");
    }

    visit(root);
    const text = parts
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, images };
  }

  /* ---------- 评论 ----------
   * 结构（2026-11 实测 post/117510）：
   *   列表   .post__comments__main > .comp__CommentItem（只有顶层，回复不带这个类）
   *   作者   .ss__user__nickname（回落到头像 img[alt]）
   *   正文   .comment__text
   *   时间   .right__section .info 里最后一个时间片段
   *   回复   .comp__CommentItemInfo__reply（嵌套在顶层评论里，自带 header/text）
   *   更多   .ss__loading__btn__load，全部加载完会换成 .ss__loading--end
   */
  function commentAuthor(el) {
    const nick = squash(el.querySelector(".ss__user__nickname")?.textContent);
    if (nick) return nick;
    return squash(el.querySelector(".ss__portrait img[alt]")?.getAttribute("alt"));
  }

  function commentTime(el) {
    const raw = squash(el.querySelector(".right__section .info")?.textContent);
    const m = /(\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日)/.exec(raw);
    return m ? m[1] : "";
  }

  function commentText(el) {
    return squash(el.querySelector(".comment__text")?.textContent);
  }

  function readComments(root = document) {
    const items = [...root.querySelectorAll(".post__comments__main > .comp__CommentItem")];
    return items
      .map((item) => ({
        author: commentAuthor(item),
        time: commentTime(item),
        text: commentText(item),
        replies: [...item.querySelectorAll(".comp__CommentItemInfo__reply")]
          .map((r) => ({ author: commentAuthor(r), time: commentTime(r), text: commentText(r) }))
          .filter((r) => r.text),
      }))
      .filter((c) => c.text || c.replies.length)
      .slice(0, MAX_COMMENTS);
  }

  /* 「更多」按钮只在一屏装不下时出现，点完会换成「已加载全部」。点完一轮要等一下再读，
   * 否则拿到的还是上一批。 */
  async function loadAllComments(max = 20) {
    for (let i = 0; i < max; i++) {
      const btn = document.querySelector(".post__comments__main .ss__loading__btn__load");
      if (!btn || btn.offsetParent === null) return;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  function readArticle() {
    const idMatch = ARTICLE_RE.exec(location.pathname);
    const root =
      document.querySelector(".article__main__content") ||
      document.querySelector(".article-body");
    if (!idMatch || !root) return null;

    const ld = ldJson();
    const title =
      squash(document.querySelector("h1#article-title")?.textContent) ||
      squash(ld && ld.headline) ||
      squash(document.title).replace(/\s*-\s*少数派\s*$/, "");
    if (!title) return null;

    const nick =
      squash(ld && ld.author && ld.author.name) ||
      squash(document.querySelector(".article__header__author img[alt]")?.alt) ||
      squash(document.querySelector(".article__header__author a")?.textContent) ||
      "";

    const time = parseDate(
      squash(document.querySelector(".article__header__date")?.textContent) ||
        (ld && ld.datePublished) ||
        ""
    );

    const { text, images } = walkBody(root);
    const iframes = root.querySelectorAll("iframe").length;

    return {
      id: idMatch[1],
      title,
      nick,
      time,
      body: text,
      images,
      iframes,
      url: "https://sspai.com/post/" + idMatch[1],
    };
  }

  /* ---------- 抓取与投递 ---------- */

  /* 扩展名以「实际拿到的字节」为准。
   * CDN 会把 jpeg 转成 webp，chrome.downloads 拿到 image/webp 就会把 .jpeg 改写成 .webp，
   * md 里的引用必须跟着变，否则引用对不上落盘的文件。 */
  const MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
  };

  function extFromMime(type) {
    const key = String(type || "").split(";")[0].trim().toLowerCase();
    return MIME_EXT[key] || "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /* 直接交给下载器会 403（见文件头）。所以先在这里抓成 data: URL，再让后台照常下载。
   * 一次把几十张大图 base64 塞进同一条消息会撑爆内存，分批发还能顺便给按钮报进度。 */
  const BATCH = 5;

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const withComments = !!options.withComments;
    const pick = options.mode === "small" ? "small" : "origin";
    if (withComments) await loadAllComments();
    const layout = RN.layout(info.title, info.nick, info.time);
    const total = info.images.length;
    const names = new Array(total);
    let done = 0;
    let mediaError = "";

    /* 选了「跳过」就一张都不抓：names 全空，下面按索引替换占位符时会把图片整段抹掉，
     * md 里只剩文字，不会留下指向不存在文件的引用。 */
    /* 同值得买：媒体整段包 try，抓图抛异常也不能把 md 一起带走。 */
    try {
    for (let i = 0; i < total && withMedia; i += BATCH) {
      const batch = [];
      for (let j = i; j < Math.min(i + BATCH, total); j++) {
        const origin = info.images[j];
        const src = pick === "small" ? smallUrl(origin) : origin;
        let url = src;
        let ext = extOf(origin);
        try {
          const res = await fetch(src, { credentials: "omit" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const blob = await res.blob();
          url = await blobToDataUrl(blob);
          ext = extFromMime(blob.type) || ext;
        } catch (e) {
          // 抓不到就退回原地址，让下载器自己再试一次
        }
        names[j] = RN.mediaPath(layout.mediaStem, j + 1, ext);
        batch.push({ filename: layout.prefix + names[j], url });
      }
      await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: batch } });
      done += batch.length;
      if (onProgress) onProgress(done, total);
    }
    } catch (e) {
      mediaError = (e && e.message) || String(e);
      console.warn("小红虾 · 媒体下发中断", e);
    }

    /* md 放在最后：文件名要等字节抓完才知道。
     * 正文里的图片位置是占位符，这里按索引换成真实文件名，顺序不会乱。 */
    let body = info.body.replace(/\u0000(\d+)\u0000/g, (_, n) => {
      const name = names[Number(n)];
      return name ? `![${Number(n) + 1}](${RN.rel(name)})` : "";
    });
    if (mediaError) {
      body += "\n\n> 图片下发中断（" + mediaError + "），正文照存，缺的图重存一次即可。";
    }
    if (info.iframes) {
      body += `\n\n> 原文含 ${info.iframes} 个内嵌媒体（iframe），未下载。`;
    }
    const commentsText = withComments ? RN.commentsMarkdown(readComments()) : "";
    if (commentsText) body += "\n\n" + commentsText;

    const md = RN.markdown({
      source: "少数派",
      url: info.url,
      title: info.title,
      nick: info.nick,
      timeMs: info.time,
      type: "normal",
      counts: { images: total, videos: 0 },
      noteId: info.id,
      desc: body,
      tags: [],
      media: [],
    });

    await chrome.runtime.sendMessage({
      type: "downloadFiles",
      data: { files: [{ filename: layout.md, text: md, mime: "text/markdown" }] },
    });
    return { images: withMedia ? total : 0, md: layout.md };
  }

  /* ---------- UI ---------- */

  let slot = null;
  let panel = null;
  let stateEl = null;
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

  /* 张数只在需要时重算：readArticle() 要走一遍正文，不能挂在每帧的 tick 上。
   * 三个时机够用：建节点时、每次悬停（用户真正会看的那一刻）、以及 2.5s 后补一次
   * ——正文若是异步渲染的，晚到的那批图也能被算进去。 */
  function refreshCount() {
    if (!stateEl) return;
    const info = readArticle();
    if (!info) return;
    stateEl.textContent = info.images.length + " 张";
  }

  function paint() {
    if (!panel) return;
    for (const seg of panel.querySelectorAll(".sspai-xhx-seg")) {
      const cur = seg.dataset.group === "media" ? (media ? "1" : "0") : mode;
      for (const el of seg.querySelectorAll("button[data-value]")) {
        const on = el.dataset.value === cur;
        el.classList.toggle("is-on", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
  }

  /* 节点只建一次。
   * 少数派是 Vue 应用，异步数据（作者卡片等）到位后会把 .article__header 整块重渲染，
   * 连带清掉我们塞进去的节点。所以不能「丢了就重建」——那会丢选中档和展开态、
   * 还会往 document 上重复叠监听。这里复用同一个节点，被冲掉后原地挂回去即可。 */
  function ensureUI() {
    if (slot) return;

    slot = document.createElement("span");
    slot.className = "sspai-xhx-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "sspai-xhx-entry";
    entry.title = "小红虾 · 保存这篇文章";
    entry.innerHTML =
      '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "sspai-xhx-panel";
    panel.innerHTML =
      '<div class="sspai-xhx-qhead">图片<span class="cnt"></span></div>' +
      '<div class="sspai-xhx-seg" data-group="media">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="sspai-xhx-seg" data-group="mode">' +
      '<button type="button" data-value="origin">原图</button>' +
      '<button type="button" data-value="small">1120</button>' +
      "</div>" +
      '<div class="sspai-xhx-actions">' +
      '<button type="button" class="sspai-xhx-act" data-comments="0">正文</button>' +
      '<button type="button" class="sspai-xhx-act is-ghost" data-comments="1">正文+回复</button>' +
      "</div>";

    slot.appendChild(entry);
    slot.appendChild(panel);

    stateEl = panel.querySelector(".sspai-xhx-qhead .cnt");

    /* 点胶囊＝按当前选择直接存（正文，不带回复），跟小红书一致。
     * 面板只靠悬停展开，点击不再开合——四个站里只有小红书一键下载，手感对不上。 */
    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const primary = panel.querySelector('.sspai-xhx-act[data-comments="0"]');
      if (primary && !primary.disabled) primary.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount();
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });

    for (const seg of panel.querySelectorAll(".sspai-xhx-seg")) {
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

    /* 两个动作＝存到哪儿为止，跟小红书、Chiphell 一致：点哪个就按哪个范围存。 */
    for (const act of panel.querySelectorAll(".sspai-xhx-act")) {
      act.addEventListener("click", async () => {
        const info = readArticle();
        if (!info || act.disabled) return;
        for (const b of panel.querySelectorAll(".sspai-xhx-act")) b.disabled = true;
        const label = act.textContent;
        const withMedia = media;
        try {
          act.textContent = withMedia ? "0/" + info.images.length : "保存中";
          await deliver(
            info,
            (done, total) => {
              act.textContent = done + "/" + total;
            },
            { mode, withMedia, withComments: act.dataset.comments === "1" }
          );
          act.textContent = "已提交";
        } catch (e) {
          act.textContent = "失败";
        } finally {
          setTimeout(() => {
            for (const b of panel.querySelectorAll(".sspai-xhx-act")) b.disabled = false;
            act.textContent = label;
            setOpen(false);
          }, 900);
        }
      });
    }

    paint();
    refreshCount();
    setTimeout(refreshCount, 2500);
  }

  function findAnchor() {
    return (
      document.querySelector(".article__important__header__side") ||
      document.querySelector(".article__header__footer") ||
      document.querySelector(".article__header__content") ||
      document.querySelector(".article__header") ||
      // 重要文章等新版式可能整组换 class；标题父容器是最后的通用挂载点。
      document.querySelector("#article-title")?.parentElement
    );
  }

  function tick() {
    if (!ARTICLE_RE.test(location.pathname)) return;
    const anchor = findAnchor();
    if (!anchor) return;
    ensureUI();
    if (slot.parentElement !== anchor) anchor.appendChild(slot);
  }

  // 文档级监听只装一次，和节点生命周期解耦
  document.addEventListener("click", (e) => {
    if (slot && !slot.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  /* 被 Vue 冲掉后要在同一帧内挂回，否则用户会看到胶囊闪一下。
   * MutationObserver + rAF 合帧：tick 只做两次 querySelector 和一次父节点比较，很轻。 */
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      tick();
    });
  }

  tick();
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  setInterval(tick, 1500);
})();
