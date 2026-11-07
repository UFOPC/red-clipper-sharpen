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

  /* 未截断的总页数；MAX_PAGES 的钳制交给调用方，好让"被截断"这件事能被写进 md。 */
  function maxPageRaw(root) {
    let max = 1;
    for (const link of root.querySelectorAll(".pg a")) {
      const page = Number(new URL(link.href, location.href).searchParams.get("page") || link.textContent.trim());
      if (Number.isInteger(page) && page > max) max = page;
    }
    return max;
  }

  const maxPage = (root) => Math.min(maxPageRaw(root), MAX_PAGES);

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
      const data = collect(doc, options);
      /* 风控验证页、登录墙、"帖子不存在"页返回的都是 200，但一楼层都解析不出来。
       * 这种空页必须算失败：否则跨页抓取会静默少页，状态栏还报「已提交」。 */
      if (!data.articlePosts.length && !data.comments.length) return null;
      return { doc, data };
    } catch (e) {
      return null;
    }
  }

  async function collectAll(options = prefs) {
    const current = collect(document, options);
    const failedPages = [];
    const truncated = [];
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
      } else {
        // 回第 1 页取元信息失败：目录名/作者/时间会退化成当前页口径，也必须留痕
        failedPages.push(1);
      }
    }

    const finish = () => {
      if (base.comments.length > MAX_COMMENTS) {
        truncated.push(`仅保留前 ${MAX_COMMENTS} 条回复（共 ${base.comments.length} 条）`);
        base.comments = base.comments.slice(0, MAX_COMMENTS);
      }
      return { ...base, failedPages, truncated };
    };

    if (!authorId) return finish();

    const rawPages = maxPageRaw(root);
    const pages = Math.min(rawPages, MAX_PAGES);
    if (rawPages > MAX_PAGES) truncated.push(`仅保留前 ${MAX_PAGES} 页（帖子共 ${rawPages} 页）`);
    for (let page = 2; page <= pages; page++) {
      if (baseIsCurrent && page === ctx.page) continue;
      const next = await fetchCollect(page, options);
      if (!next) {
        failedPages.push(page);
        continue;
      }
      base.articlePosts.push(...next.data.articlePosts);
      base.comments.push(...next.data.comments);
    }
    return finish();
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

  /* 有些站的附件域名对裸请求回 403、带 Referer 才 200（吾爱破解就是这样，站点已下架，
   * 但机制留着——微博、大众点评这类图床同样卡 Referer）。下载器发的是裸请求，
   * 页面里的 fetch 又被 CORS 拦，所以字节交给后台代取（规则补 Referer），这里只负责换成 data: URL。
   * 取不到就保留原地址，让下载器按老样子再试一次（不阻断整体保存）。
   * 启用方式：站点条目里加 mediaReferer: true，并在 rules/ 下补一条改 Referer 的静态规则。 */
  async function inlineMedia(files) {
    for (const file of files) {
      try {
        const result = await chrome.runtime.sendMessage({ type: "fetchMedia", data: { url: file.url } });
        if (!result || !result.ok || !/^image\//.test(result.type || "")) continue;
        file.url = `data:${result.type};base64,${result.base64}`;
      } catch (e) {
        /* 退回原地址 */
      }
    }
  }

  async function build(options = prefs) {
    const { articlePosts, comments, meta, failedPages = [], truncated = [] } = await collectAll(options);
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
    if (SITE.mediaReferer) await inlineMedia(files);

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
    /* 缺页与被截断都写在正文末尾：产物看起来完整、实际少一截是最难查的一类问题。 */
    if (failedPages.length) {
      parts.push(`> 第 ${failedPages.join("、")} 页抓取失败（可能触发站点风控），该页内容缺失。`, "");
    }
    if (truncated.length) {
      parts.push(`> 已截断：${truncated.join("；")}。`, "");
    }

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
        const wrote = await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: result.files } });
        /* 单条落盘失败不会抛错（响应里没有 error 字段），只能从返回值里读。
         * md 与媒体在同一条消息里，失败时 md 已经写下去了，改不了正文，
         * 所以只能在这里说实话：全成功时文案保持原样，别出现「（0 个失败）」。 */
        const failedCount = (wrote && wrote.failed && wrote.failed.length) || 0;
        const what = [];
        if (result.mediaCount) what.push(`${result.mediaCount} 张图片`);
        what.push("Markdown");
        status.textContent = `已提交 ${what.join(" + ")}` +
          (result.commentCount ? `，${result.commentCount} 条回复` : "") +
          (failedCount ? `（${failedCount} 个失败）` : "");
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
     * 既压不到登录框，也压不到「返回列表」。
     * 容器是 position: fixed（discuz.css），所以这里只能用**视口坐标**：
     * 早先加 window.scrollY 换算成文档坐标，结果带锚点进入或刷新恢复滚动位时，
     * 按钮被推到视口下方 scrollY 像素处——那正是修掉的那个 bug。 */
    const placeDock = () => {
      const viewTop = (el) => el.getBoundingClientRect().top;
      const pt = document.querySelector("#pt");
      const hd = document.querySelector("#hd");
      let top = 24;
      if (pt) top = viewTop(pt) + 2;
      else if (hd) top = viewTop(hd) + hd.offsetHeight + 12;
      dock.style.top = Math.max(12, Math.min(Math.round(top), window.innerHeight - 80)) + "px";
    };

    dock.append(button, panel, status);
    document.documentElement.append(dock);
    placeDock();
    window.addEventListener("resize", placeDock);
    renderSegs();
  }

  loadPrefs().then(mount);
})();
