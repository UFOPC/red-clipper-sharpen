/* Discuz! X 系论坛通用适配
 *
 * 一份引擎覆盖多个 Discuz 站，站点差异只在 SITES 表里的一小段配置：
 * URL 解析 / 规范链接 / 翻页地址。DOM 侧选择器全部按 Discuz! X3 标准结构，
 * 以下这些**不是** Chiphell 私有（原 chiphell.js 里的实测记录继续有效）：
 *   正文   td.t_f[id^="postmessage_"]
 *   楼层   [id^="post_"]
 *   作者   .authi .xw1
 *   时间   em[id^="authorposton"]
 *   附件格 .pattl / .tattl 里的 ignore_js_op > dl.tattl > div.savephotop
 *   引用   .quote        翻页 .pg a        面包屑 #pt
 *
 * 新增站点：往 SITES 里加一条，manifest 的 matches 加上域名即可，不用写新 JS。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  /* ---------------- 站点表 ---------------- */

  const DZ = "https://www.chiphell.com";

  const SITES = [
    {
      id: "chiphell",
      host: /^(?:www\.)?chiphell\.com$/i,
      source: "Chiphell",
      parse(loc) {
        const params = new URLSearchParams(loc.search);
        const m = loc.pathname.match(/^\/thread-(\d+)-(\d+)-(\d+)\.html$/);
        const tid = m ? m[1] : (params.get("mod") === "viewthread" ? params.get("tid") : "");
        if (!tid) return null;
        return {
          tid,
          page: (m ? Number(m[2]) : Number(params.get("page"))) || 1,
          authorId: params.get("authorid") || "",
          url: `${DZ}/thread-${tid}-1-1.html`,
        };
      },
      pageUrl: ({ tid, page, authorId }) =>
        `${DZ}/forum.php?mod=viewthread&tid=${tid}&page=${page}` +
        (authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""),
    },
    {
      id: "pcbeta",
      host: /^bbs\.pcbeta\.com$/i,
      source: "远景论坛",
      parse(loc) {
        const params = new URLSearchParams(loc.search);
        const staticMatch = loc.pathname.match(/^\/viewthread-(\d+)-(\d+)-(\d+)\.html$/);
        const tid = staticMatch ? staticMatch[1] : params.get("tid");
        if (!tid) return null;
        return {
          tid,
          page: (staticMatch ? Number(staticMatch[2]) : Number(params.get("page"))) || 1,
          authorId: params.get("authorid") || "",
          url: `https://bbs.pcbeta.com/viewthread-${tid}-1-1.html`,
        };
      },
      pageUrl: ({ tid, page, authorId }) =>
        `https://bbs.pcbeta.com/forum.php?mod=viewthread&tid=${tid}&page=${page}` +
        (authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""),
    },
    {
      id: "52pojie",
      host: /^(?:www\.)?52pojie\.cn$/i,
      source: "吾爱破解",
      parse(loc) {
        const params = new URLSearchParams(loc.search);
        const m = loc.pathname.match(/^\/thread-(\d+)-(\d+)-(\d+)\.html$/);
        const tid = m ? m[1] : (params.get("mod") === "viewthread" ? params.get("tid") : "");
        if (!tid) return null;
        return {
          tid,
          page: (m ? Number(m[2]) : Number(params.get("page"))) || 1,
          authorId: params.get("authorid") || "",
          url: `https://www.52pojie.cn/thread-${tid}-1-1.html`,
        };
      },
      pageUrl: ({ tid, page, authorId }) =>
        `https://www.52pojie.cn/forum.php?mod=viewthread&tid=${tid}&page=${page}` +
        (authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""),
    },
    {
      /* 恩山的帖子路径带一层 /forum/：thread-8287728-1-1.html 在 /forum/ 下 */
      id: "right",
      host: /^(?:www\.)?right\.com\.cn$/i,
      source: "恩山无线",
      parse(loc) {
        const params = new URLSearchParams(loc.search);
        const m = loc.pathname.match(/^\/forum\/thread-(\d+)-(\d+)-(\d+)\.html$/);
        const tid = m ? m[1] : (params.get("mod") === "viewthread" ? params.get("tid") : "");
        if (!tid) return null;
        return {
          tid,
          page: (m ? Number(m[2]) : Number(params.get("page"))) || 1,
          authorId: params.get("authorid") || "",
          url: `https://www.right.com.cn/forum/thread-${tid}-1-1.html`,
        };
      },
      pageUrl: ({ tid, page, authorId }) =>
        `https://www.right.com.cn/forum/forum.php?mod=viewthread&tid=${tid}&page=${page}` +
        (authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""),
    },
    {
      /* 首页 erji.net 会跳到 bbs.erji.net，帖子走 forum.php?mod=viewthread&tid=…（不静态化） */
      id: "erji",
      host: /^(?:bbs\.)?erji\.net$/i,
      source: "耳机大家坛",
      parse(loc) {
        const params = new URLSearchParams(loc.search);
        const m = loc.pathname.match(/^\/thread-(\d+)-(\d+)-(\d+)\.html$/);
        const tid = m ? m[1] : (params.get("mod") === "viewthread" ? params.get("tid") : "");
        if (!tid) return null;
        return {
          tid,
          page: (m ? Number(m[2]) : Number(params.get("page"))) || 1,
          authorId: params.get("authorid") || "",
          url: `https://bbs.erji.net/forum.php?mod=viewthread&tid=${tid}`,
        };
      },
      pageUrl: ({ tid, page, authorId }) =>
        `https://bbs.erji.net/forum.php?mod=viewthread&tid=${tid}&page=${page}` +
        (authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""),
    },
  ];

  const SITE = SITES.find((site) => site.host.test(location.hostname));
  if (!SITE) return;

  const ctx = SITE.parse(new URL(location.href));
  if (!ctx) return;
  const { tid, authorId } = ctx;
  if (document.querySelector(".xhx-dz-btn")) return;

  /* ---------------- 通用工具 ---------------- */

  const IMG_SKIP = /(?:^|\/)none\.gif$/i;
  const BLOCK_TAGS = new Set(["div", "p", "blockquote", "tr", "table", "ul", "ol", "li"]);
  const MAX_PAGES = 30;
  const MAX_COMMENTS = 300;

  const PREFS_KEY = "dz-prefs";
  /* 只有「图片要不要」是需要记住的偏好；回复是每次点按钮时决定的，
   * 不进 prefs——否则面板上会出现一个「上次选过」的隐形状态。 */
  const DEFAULT_PREFS = { media: true };
  const prefs = { ...DEFAULT_PREFS };

  function absUrl(raw) {
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (e) {
      return "";
    }
  }

  function extOf(url) {
    try {
      const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      return match ? "." + match[1].toLowerCase() : ".jpg";
    } catch (e) {
      return ".jpg";
    }
  }

  function imageUrl(img) {
    let raw = img.getAttribute("zoomfile") || img.getAttribute("file") || img.getAttribute("data-original") || "";
    if (!raw) {
      const src = img.getAttribute("src") || "";
      if (!/^(?:https?:)?\/\//i.test(src) || img.hasAttribute("smilieid") || img.classList.contains("smiley")) return "";
      raw = src;
    }
    const url = absUrl(raw);
    if (!url) return "";
    try {
      return IMG_SKIP.test(new URL(url).pathname) ? "" : url;
    } catch (e) {
      return "";
    }
  }

  function tidy(text) {
    return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function htmlToText(root, onImage) {
    const out = [];
    const emitImage = (img) => {
      if (!onImage || !img) return false;
      const url = imageUrl(img);
      if (!url) return false;
      const markdown = onImage(url);
      if (!markdown) return false;
      out.push("\n\n", markdown, "\n\n");
      return true;
    };
    const walk = (node) => {
      if (node.nodeType === 3) {
        out.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style") return;
      if (tag === "ignore_js_op") {
        emitImage(node.querySelector("img"));
        return;
      }
      if (tag === "img") {
        emitImage(node);
        return;
      }
      if (tag === "br") {
        out.push("\n");
        return;
      }
      if (tag === "a") {
        /* <a href="…"><img …></a>（[url=][img] 的产物）必须先走子树，
         * 否则「图片链接」被当成纯链接、图片整张丢掉。 */
        if (node.querySelector("img")) {
          for (const child of node.childNodes) walk(child);
          return;
        }
        const text = node.textContent.replace(/\s+/g, " ").trim();
        if (!text) return;
        const href = absUrl(node.getAttribute("href"));
        out.push(href ? `[${text}](${href})` : text);
        return;
      }
      if (tag === "blockquote") {
        out.push("\n> ");
        for (const child of node.childNodes) walk(child);
        out.push("\n");
        return;
      }
      if (BLOCK_TAGS.has(tag)) out.push("\n");
      for (const child of node.childNodes) walk(child);
      if (BLOCK_TAGS.has(tag)) out.push("\n");
    };
    walk(root);
    return tidy(out.join(""));
  }

  /* Discuz 把「没插进正文」的附件图排在帖子底部的附件格里：
   *   <div class="pattl"> <ignore_js_op> <dl class="tattl attm"> <div class="mbn savephotop">
   *       <img id="aimg_…" src="none.gif" zoomfile="…" file="…">
   * 这一坨在 td.plc 里、td.t_f 之外，只按正文 DOM 走会整批漏掉
   * （实测 tid=2915041：正文 7 张、附件格 29 张，一共 36 张）。 */
  function attachmentImages(post) {
    const holder = post.closest('[id^="post_"]') || post;
    return [...holder.querySelectorAll(".pattl img, .tattl img")]
      .filter((img) => !img.closest(".quote, .tip"))
      .map(imageUrl)
      .filter(Boolean);
  }

  function postImages(post) {
    const urls = [
      ...[...post.querySelectorAll("img")]
        .filter((img) => !img.closest(".quote, .tip"))
        .map(imageUrl),
      ...attachmentImages(post),
    ].filter(Boolean);
    return [...new Set(urls)];
  }

  function postText(post) {
    const clone = post.cloneNode(true);
    clone.querySelectorAll(".quote, .tip, .pstatus, script, style, ignore_js_op").forEach((node) => node.remove());
    clone.querySelectorAll("img").forEach((node) => node.remove());
    return htmlToText(clone);
  }

  function postBody(post, onImage) {
    const clone = post.cloneNode(true);
    clone.querySelectorAll(".quote, .tip, .pstatus, script, style").forEach((node) => node.remove());
    if (!onImage) return htmlToText(clone);
    /* 同一张图既插在正文又留在附件格时只留一处，避免 MD 里出现重复引用。 */
    const seen = new Set();
    const take = (url) => {
      if (seen.has(url)) return "";
      seen.add(url);
      return onImage(url);
    };
    const text = htmlToText(clone, take);
    const extra = attachmentImages(post).map(take).filter(Boolean);
    return tidy([text, ...extra.map((markdown) => `\n\n${markdown}\n\n`)].join(""));
  }

  function quoteText(post) {
    const clone = post.cloneNode(true);
    const quote = clone.querySelector(".quote");
    return quote ? tidy(quote.textContent.replace(/\s+/g, " ")) : "";
  }

  function postsIn(root) {
    return [...root.querySelectorAll('td.t_f[id^="postmessage_"]')];
  }

  function postMeta(post) {
    const holder = post.closest('[id^="post_"]') || post;
    const author = (holder.querySelector(".authi .xw1")?.textContent || "").trim();
    const timeText = holder.querySelector('em[id^="authorposton"]')?.textContent || "";
    const match = timeText.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const time = match
      ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")} ${match[4].padStart(2, "0")}:${match[5]}`
      : "";
    return { author, time };
  }

  function maxPage(root) {
    let max = 1;
    for (const link of root.querySelectorAll(".pg a")) {
      const page = Number(new URL(link.href, location.href).searchParams.get("page") || link.textContent.trim());
      if (Number.isInteger(page) && page > max) max = page;
    }
    return Math.min(max, MAX_PAGES);
  }

  const pageUrl = (page) => SITE.pageUrl({ tid, page, authorId });

  function readMeta(root = document) {
    const title = (root.querySelector("#thread_subject")?.textContent || root.title.split(" - ")[0] || "").trim();
    const author = (root.querySelector(".authi .xw1")?.textContent || "").trim();
    const timeText = root.querySelector('em[id^="authorposton"]')?.textContent || "";
    const match = timeText.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const timeMs = match
      ? new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]).getTime()
      : Date.now();
    return { title, author, timeMs };
  }

  function collect(root, options = prefs) {
    const meta = readMeta(root);
    const posts = postsIn(root);
    if (!posts.length) return { articlePosts: [], comments: [], meta };

    const article = [posts[0]];
    const rest = [];
    for (const post of posts.slice(1)) {
      if (authorId && !post.querySelector(".quote") && postImages(post).length) article.push(post);
      else rest.push(post);
    }

    const replies = options.comments
      ? rest.slice(0, MAX_COMMENTS).map((post) => ({
        ...postMeta(post),
        quote: quoteText(post),
        text: postText(post),
      })).filter((item) => item.text || item.quote)
      : [];

    return { articlePosts: article, comments: replies, meta };
  }

  async function fetchCollect(page, options = prefs) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const response = await fetch(pageUrl(page), { credentials: "include" });
      if (!response.ok) return null;
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      return { doc, data: collect(doc, options) };
    } catch (e) {
      return null;
    }
  }

  async function collectAll(options = prefs) {
    const current = collect(document, options);
    let base = current;
    let root = document;
    let baseIsCurrent = true;
    if (ctx.page > 1) {
      const first = await fetchCollect(1, options);
      if (first) {
        if (!authorId) first.data.comments.push(...current.comments);
        base = first.data;
        root = first.doc;
        baseIsCurrent = false;
      }
    }
    if (!authorId) {
      base.comments = base.comments.slice(0, MAX_COMMENTS);
      return base;
    }

    const pages = maxPage(root);
    for (let page = 2; page <= pages; page++) {
      if (baseIsCurrent && page === ctx.page) continue;
      const next = await fetchCollect(page, options);
      if (!next) continue;
      base.articlePosts.push(...next.data.articlePosts);
      base.comments.push(...next.data.comments);
    }
    base.comments = base.comments.slice(0, MAX_COMMENTS);
    return base;
  }

  function commentsMarkdown(comments) {
    if (!comments.length) return "";
    const clean = (text) => String(text || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    const lines = ["## 评论", ""];
    comments.forEach((comment, index) => {
      lines.push(`${index + 1}. **${comment.author || "匿名"}**${comment.time ? ` · ${comment.time}` : ""}`);
      const quote = clean(comment.quote);
      if (quote) lines.push("", `   > ${quote.replace(/\n/g, "\n   > ")}`);
      const text = clean(comment.text);
      if (text) lines.push("", `   ${text.replace(/\n/g, "\n   ")}`);
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function build(options = prefs) {
    const { articlePosts, comments, meta } = await collectAll(options);
    const layout = RN.layout(meta.title, meta.author, meta.timeMs);
    const media = [];
    const byUrl = new Map();
    const imageMd = (url) => {
      if (!byUrl.has(url)) {
        media.push(url);
        byUrl.set(url, media.length);
      }
      const index = byUrl.get(url);
      return `![${index}](${RN.rel(RN.mediaPath(layout.mediaStem, index, extOf(url)))})`;
    };
    const onImage = options.media ? imageMd : null;
    const body = articlePosts.map((post) => postBody(post, onImage)).filter(Boolean).join("\n\n").trim();
    const files = media.map((url, index) => ({
      filename: layout.prefix + RN.mediaPath(layout.mediaStem, index + 1, extOf(url)),
      url,
    }));

    const parts = [
      RN.frontmatter({
        title: meta.title,
        nick: meta.author,
        timeMs: meta.timeMs,
        type: "normal",
        counts: { images: media.length, videos: 0 },
        noteId: tid,
        source: SITE.source,
        url: ctx.url,
      }),
      "",
      `# ${meta.title}`,
      "",
    ];
    if (body) parts.push(body, "");
    const commentsText = options.comments ? commentsMarkdown(comments) : "";
    if (commentsText) parts.push(commentsText, "");

    const markdown = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    files.push({ filename: layout.md, text: markdown, mime: "text/markdown" });
    return { files, mediaCount: media.length, commentCount: comments.length };
  }

  // 面板上展示的「这些图一共多大」：按 collect() 认定的正文楼层统计，按 URL 去重，
  // 与真正要下载的集合保持一致；外链图没有体积信息时单独计数。
  function mediaSummary(root = document, options = prefs) {
    const posts = collect(root, options).articlePosts;
    const seen = new Set();
    for (const post of posts) {
      for (const url of postImages(post)) seen.add(url);
    }
    return { count: seen.size };
  }

  function loadPrefs() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(PREFS_KEY, (data) => {
          const saved = data && data[PREFS_KEY];
          if (saved && typeof saved === "object") {
            prefs.media = saved.media !== false;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function savePrefs() {
    try {
      chrome.storage.local.set({ [PREFS_KEY]: { ...prefs } });
    } catch (e) {
      /* 存不上也不影响本次下载 */
    }
  }

  function mount() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xhx-dz-btn";
    button.title = "保存本帖正文与图片";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon.svg")}" alt=""><span>剪藏</span>`;

    const panel = document.createElement("div");
    panel.className = "xhx-dz-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "保存本帖");
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="xhx-dz-row">',
      '  <div class="xhx-dz-key">图片<span class="cnt"></span></div>',
      '  <div class="xhx-dz-seg" data-group="media">',
      '    <button type="button" data-value="1">下载</button>',
      '    <button type="button" data-value="0">跳过</button>',
      "  </div>",
      "</div>",
      /* 「存正文」还是「连回复一起存」不再是面板上的一个开关，
       * 而是两个动作本身——跟小红书图文贴同一套：上面选要不要图，下面选存到哪儿为止。 */
      '<div class="xhx-dz-actions">',
      '  <button type="button" class="xhx-dz-go" data-comments="0">正文</button>',
      '  <button type="button" class="xhx-dz-go is-ghost" data-comments="1">正文+回复</button>',
      "</div>",
    ].join("");

    const status = document.createElement("div");
    status.className = "xhx-dz-status";

    // 容器只负责定位与 hover 判定，视觉仍由 button / panel 各自决定。
    const dock = document.createElement("div");
    dock.className = "xhx-dz-dock";

    const countEl = panel.querySelector(".xhx-dz-key .cnt");
    const segs = [...panel.querySelectorAll(".xhx-dz-seg")];

    const renderSegs = () => {
      for (const seg of segs) {
        const key = seg.dataset.group;
        for (const option of seg.querySelectorAll("button")) {
          const on = (option.dataset.value === "1") === prefs[key];
          option.classList.toggle("is-on", on);
          option.setAttribute("aria-pressed", on ? "true" : "false");
        }
      }
    };

    /* 只报张数，不报体积：Discuz 只给附件写了确切字节，外链图一律算不出，
     * 报出来的只是「已知那部分的合计」，比不报更容易误导。
     * 张数挂在这一行的标签上（跟少数派/什么值得买一致），不再单独占一行说明。 */
    const renderHint = () => {
      const { count } = mediaSummary();
      const scope = authorId && maxPage(document) > 1 ? "本页 " : "";
      countEl.textContent = count ? `${scope}${count} 张` : "无";
    };

    const openPanel = () => {
      if (!panel.hidden) return;
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      renderSegs();
      renderHint();
    };

    const closePanel = () => {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };

    /* 四个站统一：悬停展开面板，点胶囊＝按当前选择直接存（正文，不带回复）。
     * 点击不再开合面板——否则四个站里只有小红书是一键下载，手感对不上。 */
    dock.addEventListener("mouseenter", () => {
      if (button.dataset.busy) return; // 下载中别把面板又唤出来盖住进度
      openPanel();
    });
    dock.addEventListener("mouseleave", closePanel);

    button.addEventListener("click", () => {
      if (button.dataset.busy) return;
      run(false);
    });

    for (const seg of segs) {
      seg.addEventListener("click", (event) => {
        const option = event.target.closest("button[data-value]");
        if (!option) return;
        prefs[seg.dataset.group] = option.dataset.value === "1";
        savePrefs();
        renderSegs();
        renderHint();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
    });

    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || button.contains(event.target)) return;
      closePanel();
    });

    const run = async (withComments) => {
      if (button.dataset.busy) return;
      closePanel();
      button.dataset.busy = "1";
      button.classList.add("is-busy");
      status.textContent = "正在整理…";
      try {
        const result = await build({ media: prefs.media, comments: withComments });
        if (!result.files.length) throw new Error("没有找到可下载的内容");
        await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: result.files } });
        const what = [];
        if (result.mediaCount) what.push(`${result.mediaCount} 张图片`);
        what.push("Markdown");
        status.textContent = `已提交 ${what.join(" + ")}` +
          (result.commentCount ? `，${result.commentCount} 条回复` : "");
      } catch (error) {
        status.textContent = "保存失败：" + (error?.message || error);
      } finally {
        button.dataset.busy = "";
        button.classList.remove("is-busy");
        setTimeout(() => {
          status.textContent = "";
        }, 6000);
      }
    };

    for (const goBtn of panel.querySelectorAll(".xhx-dz-go")) {
      goBtn.addEventListener("click", () => run(goBtn.dataset.comments === "1"));
    }

    /* 站方页头（#hd）和「返回列表」都占着右上角。
     * 面包屑条 #pt 的右半截是空的，把胶囊放进去正好落在内容区右上角，
     * 既压不到登录框，也压不到「返回列表」。坐标用文档坐标，
     * 避免「刷新时页面已滚动」把按钮顶到错误位置。 */
    const placeDock = () => {
      const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
      const pt = document.querySelector("#pt");
      const hd = document.querySelector("#hd");
      let top = 24;
      if (pt) top = docTop(pt) + 2;
      else if (hd) top = docTop(hd) + hd.offsetHeight + 12;
      dock.style.top = Math.max(12, Math.round(top)) + "px";
    };

    dock.append(button, panel, status);
    document.documentElement.append(dock);
    placeDock();
    window.addEventListener("resize", placeDock);
    renderSegs();
  }

  loadPrefs().then(mount);
})();
