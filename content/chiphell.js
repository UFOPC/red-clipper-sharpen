(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const params = new URLSearchParams(location.search);
  const pathMatch = location.pathname.match(/^\/thread-(\d+)-(\d+)-(\d+)\.html$/);
  const tid = pathMatch ? pathMatch[1] : (params.get("mod") === "viewthread" ? params.get("tid") : "");
  if (!tid) return;
  const authorId = params.get("authorid") || "";
  if (document.querySelector(".xhx-chh-btn")) return;

  const IMG_SKIP = /(?:^|\/)none\.gif$/i;
  const BLOCK_TAGS = new Set(["div", "p", "blockquote", "tr", "table", "ul", "ol", "li"]);
  const MAX_PAGES = 30;
  const MAX_COMMENTS = 300;

  const PREFS_KEY = "chh-prefs";
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
      out.push("\n\n", onImage(url), "\n\n");
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

  function postImages(post) {
    return [...post.querySelectorAll("img")]
      .filter((img) => !img.closest(".quote, .tip"))
      .map(imageUrl)
      .filter(Boolean);
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
    return htmlToText(clone, onImage);
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

  function pageUrl(page) {
    return `https://www.chiphell.com/forum.php?mod=viewthread&tid=${tid}&page=${page}${authorId ? `&authorid=${encodeURIComponent(authorId)}` : ""}`;
  }

  function currentPage() {
    const fromPath = pathMatch ? Number(pathMatch[2]) : 0;
    return fromPath || Number(params.get("page")) || 1;
  }

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
    if (currentPage() > 1) {
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
      if (baseIsCurrent && page === currentPage()) continue;
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
        source: "Chiphell",
        url: `https://www.chiphell.com/thread-${tid}-1-1.html`,
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
    let count = 0;
    for (const post of posts) {
      for (const img of post.querySelectorAll("img")) {
        if (img.closest(".quote, .tip")) continue;
        const url = imageUrl(img);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        count += 1;
      }
    }
    return { count };
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
    button.className = "xhx-chh-btn";
    button.title = "保存本帖正文与图片";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon.svg")}" alt=""><span>剪藏</span>`;

    const panel = document.createElement("div");
    panel.className = "xhx-chh-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "保存本帖");
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="xhx-chh-row">',
      '  <div class="xhx-chh-key">图片<span class="cnt"></span></div>',
      '  <div class="xhx-chh-seg" data-group="media">',
      '    <button type="button" data-value="1">下载</button>',
      '    <button type="button" data-value="0">跳过</button>',
      "  </div>",
      "</div>",
      /* 「存正文」还是「连回复一起存」不再是面板上的一个开关，
       * 而是两个动作本身——跟小红书图文贴同一套：上面选要不要图，下面选存到哪儿为止。 */
      '<div class="xhx-chh-actions">',
      '  <button type="button" class="xhx-chh-go" data-comments="0">正文</button>',
      '  <button type="button" class="xhx-chh-go is-ghost" data-comments="1">正文+回复</button>',
      "</div>",
    ].join("");

    const status = document.createElement("div");
    status.className = "xhx-chh-status";

    // 容器只负责定位与 hover 判定，视觉仍由 button / panel 各自决定。
    const dock = document.createElement("div");
    dock.className = "xhx-chh-dock";

    const countEl = panel.querySelector(".xhx-chh-key .cnt");
    const segs = [...panel.querySelectorAll(".xhx-chh-seg")];

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

    for (const goBtn of panel.querySelectorAll(".xhx-chh-go")) {
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
