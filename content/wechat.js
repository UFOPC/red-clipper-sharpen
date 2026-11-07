/* 微信公众号（mp.weixin.qq.com/s/…）适配
 *
 * 落盘规范**对齐 Wechat-Sharpen 管线**，不是小红虾原生的 <标题>/ 结构：
 *   目录   YYYY-MM/YY-MM-DD/            （与 09-Article 里的存量同构，拖进去就能合流）
 *   文件   <标题>.md
 *   图片   assets/<文章hash8>_<三位序号>_<图片hash8>.<真实扩展名>
 *   引用   ![图片](assets/xxx.png)
 *   frontmatter  title / source / published / created
 * description 与 tags 留给富化阶段（Wechat-Sharpen 的 classify_pipeline），这里不写空壳。
 *
 * 结构要点（2026-11 实测）：
 *   标题  #activity-name（内有 span.js_title_inner）
 *   号名  #js_name
 *   时间  #publish_time 文本形如「2026年3月25日 21:19」，**原样保留**，不转日期对象
 *   正文  #js_content
 *   图片  <img data-src="https://mmbiz.qpic.cn/…">，src 是占位图，必须取 data-src
 *   防盗链  裸请求即 200（实测 612 KB image/png），不需要 Referer，也不需要抓字节再转存
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;
  if (!/^mp\.weixin\.qq\.com$/i.test(location.hostname)) return;
  const path = location.pathname.match(/^\/s\/?([\w-]+)?/);
  if (!path) return;
  if (document.querySelector(".xhx-dz-btn")) return;

  const PREFS_KEY = "wx-prefs";
  const prefs = { media: true };
  const MAX_IMAGES = 300;
  const BLOCK = new Set(["section", "p", "div", "blockquote", "ul", "ol", "li", "tr", "table", "figure", "figcaption", "pre"]);
  const DROP = /^(script|style|svg|mp-style-type|iframe|video|audio|source)$/;

  const squash = (s) => String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  /* ---------------- 取数 ---------------- */

  function meta() {
    const title = squash(document.querySelector("#activity-name")?.textContent || document.title.split(/[-_|]/)[0]);
    const account = squash(document.querySelector("#js_name")?.textContent);
    const published = squash(document.querySelector("#publish_time")?.textContent);
    const body = document.querySelector("#js_content");
    return { title, account, published, body };
  }

  function pubDate(text) {
    const m = String(text || "").match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  /* 扩展名从 URL 判：公众号图片是 <…>/sz_mmbiz_png/<hash>/640?wx_fmt=png&from=appmsg，
   * 路径里那段和 wx_fmt 都可信；两者都没有时退回 png（该站九成是 png）。 */
  function extOf(url) {
    try {
      const u = new URL(url);
      const fmt = u.searchParams.get("wx_fmt");
      if (fmt && /^[a-z]{2,5}$/i.test(fmt)) return "." + fmt.toLowerCase().replace("jpeg", "jpg");
      const seg = u.pathname.match(/(?:mmbiz|mblog)_([a-z]{2,5})\b/i);
      if (seg) return "." + seg[1].toLowerCase().replace("jpeg", "jpg");
      const tail = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (tail) return "." + tail[1].toLowerCase();
    } catch (e) {
      /* 落到默认值 */
    }
    return ".png";
  }

  function imageUrl(img) {
    const raw = img.getAttribute("data-src") || img.getAttribute("data-backsrc") || "";
    const url = /^https?:/i.test(raw) ? raw : "";
    if (url) return url;
    const src = img.getAttribute("src") || "";
    if (/^https?:\/\/mmbiz/i.test(src)) return src;
    return "";
  }

  /* ---------------- 正文转 Markdown ---------------- */

  function toMarkdown(root, onImage) {
    const out = [];
    let imgIndex = 0;

    const walk = (node) => {
      if (node.nodeType === 3) {
        out.push(node.nodeValue.replace(/\u00a0/g, " "));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (DROP.test(tag)) return;

      if (tag === "img") {
        const url = imageUrl(node);
        if (url && onImage) {
          const md = onImage(url, imgIndex++);
          if (md) out.push("\n\n", md, "\n\n");
        }
        return;
      }
      if (tag === "br") {
        out.push("\n");
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        out.push("\n\n", "#".repeat(level), " ");
        for (const child of node.childNodes) walk(child);
        out.push("\n\n");
        return;
      }
      if (tag === "strong" || tag === "b") {
        out.push("**");
        for (const child of node.childNodes) walk(child);
        out.push("**");
        return;
      }
      if (tag === "em" || tag === "i") {
        out.push("*");
        for (const child of node.childNodes) walk(child);
        out.push("*");
        return;
      }
      if (tag === "code") {
        out.push("`");
        for (const child of node.childNodes) walk(child);
        out.push("`");
        return;
      }
      if (tag === "a") {
        const text = squash(node.textContent);
        const href = node.getAttribute("href") || "";
        if (!text) return;
        if (/^https?:\/\//i.test(href) && !/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) {
          out.push(`[${text}](${href})`);
        } else {
          out.push(text);
        }
        return;
      }
      if (tag === "li") {
        const parent = node.parentElement?.tagName.toLowerCase();
        const ordered = parent === "ol";
        const index = ordered ? [...node.parentElement.children].indexOf(node) + 1 : 0;
        out.push("\n", ordered ? `${index}. ` : "- ");
        for (const child of node.childNodes) walk(child);
        return;
      }
      if (tag === "blockquote") {
        out.push("\n\n> ");
        for (const child of node.childNodes) walk(child);
        out.push("\n\n");
        return;
      }
      if (BLOCK.has(tag)) out.push("\n\n");
      for (const child of node.childNodes) walk(child);
      if (BLOCK.has(tag)) out.push("\n\n");
    };

    walk(root);
    return out.join("")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* ---------------- 落盘规划 ---------------- */

  const pad = (n) => (n < 10 ? "0" + n : String(n));

  function hash8(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  function safeName(text) {
    return String(text || "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80) || "未命名";
  }

  function dirOf(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function quote(text) {
    return '"' + String(text || "").replace(/"/g, '\\"') + '"';
  }

  /* ---------------- 组装 ---------------- */

  function build(options = prefs) {
    const { title, account, published, body } = meta();
    if (!body) throw new Error("找不到正文容器 #js_content");

    const aid = hash8(location.pathname + location.search);
    const dir = dirOf(pubDate(published));
    const media = [];
    const byUrl = new Map();

    const onImage = options.media
      ? (url, index) => {
        if (!byUrl.has(url)) {
          const name = `${aid}_${String(index).padStart(3, "0")}_${hash8(url)}${extOf(url)}`;
          media.push({ url, name });
          byUrl.set(url, name);
          if (media.length > MAX_IMAGES) return "";
        }
        return `![图片](assets/${byUrl.get(url)})`;
      }
      : null;

    const markdown = toMarkdown(body, onImage);
    const files = media.map((item) => ({
      filename: `${dir}/assets/${item.name}`,
      url: item.url,
    }));

    const front = [
      "---",
      `title: ${quote(title)}`,
      `source: ${quote(location.href.split("#")[0])}`,
      `published: ${quote(published)}`,
      `created: ${quote(todayStamp())}`,
      "---",
      "",
      "",
    ].join("\n");

    files.push({
      filename: `${dir}/${safeName(title)}.md`,
      text: front + markdown + "\n",
      mime: "text/markdown",
    });

    return {
      files,
      title,
      account,
      dir,
      mediaCount: media.length,
      chars: markdown.length,
    };
  }

  /* ---------------- UI ---------------- */

  function loadPrefs() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(PREFS_KEY, (data) => {
          const saved = data && data[PREFS_KEY];
          if (saved && typeof saved === "object") prefs.media = saved.media !== false;
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
      /* 存不上不影响本次 */
    }
  }

  function mount() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xhx-dz-btn";
    button.title = "保存这篇公众号文章";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon.svg")}" alt=""><span>剪藏</span>`;

    const panel = document.createElement("div");
    panel.className = "xhx-dz-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "保存本文");
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="xhx-dz-row">',
      '  <div class="xhx-dz-key">图片<span class="cnt"></span></div>',
      '  <div class="xhx-dz-seg" data-group="media">',
      '    <button type="button" data-value="1">下载</button>',
      '    <button type="button" data-value="0">跳过</button>',
      "  </div>",
      "</div>",
      '<div class="xhx-dz-actions">',
      '  <button type="button" class="xhx-dz-go" data-comments="0">正文</button>',
      "</div>",
    ].join("");

    const status = document.createElement("div");
    status.className = "xhx-dz-status";
    const dock = document.createElement("div");
    dock.className = "xhx-dz-dock";

    const countEl = panel.querySelector(".xhx-dz-key .cnt");
    const seg = panel.querySelector(".xhx-dz-seg");

    const renderSeg = () => {
      for (const option of seg.querySelectorAll("button")) {
        const on = (option.dataset.value === "1") === prefs.media;
        option.classList.toggle("is-on", on);
        option.setAttribute("aria-pressed", on ? "true" : "false");
      }
    };

    const renderHint = () => {
      const n = document.querySelectorAll("#js_content img").length;
      countEl.textContent = n ? `${n} 张` : "无";
    };

    const openPanel = () => {
      if (!panel.hidden) return;
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      renderSeg();
      renderHint();
    };
    const closePanel = () => {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };

    dock.addEventListener("mouseenter", () => {
      if (button.dataset.busy) return;
      openPanel();
    });
    dock.addEventListener("mouseleave", closePanel);

    seg.addEventListener("click", (event) => {
      const option = event.target.closest("button[data-value]");
      if (!option) return;
      prefs.media = option.dataset.value === "1";
      savePrefs();
      renderSeg();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
    });
    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || button.contains(event.target)) return;
      closePanel();
    });

    const run = async () => {
      if (button.dataset.busy) return;
      closePanel();
      button.dataset.busy = "1";
      button.classList.add("is-busy");
      status.textContent = "正在整理…";
      try {
        const result = build({ media: prefs.media });
        await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: result.files } });
        const what = [];
        if (result.mediaCount) what.push(`${result.mediaCount} 张图片`);
        what.push(`${result.chars} 字正文`);
        status.textContent = `已提交 ${what.join(" + ")} → ${result.dir}`;
      } catch (error) {
        status.textContent = "保存失败：" + (error?.message || error);
      } finally {
        button.dataset.busy = "";
        button.classList.remove("is-busy");
        setTimeout(() => {
          status.textContent = "";
        }, 8000);
      }
    };

    button.addEventListener("click", run);
    panel.querySelector(".xhx-dz-go").addEventListener("click", run);

    /* 公众号页头是 #js_top_profile（桌面端还压着一条 .rich_media_tool），
     * 胶囊放在正文区左上角外侧，避开标题与「听全文」。 */
    const placeDock = () => {
      const anchor = document.querySelector(".rich_media_area_primary") || document.querySelector("#js_article");
      let top = 24;
      if (anchor) top = anchor.getBoundingClientRect().top + window.scrollY + 8;
      dock.style.top = Math.max(12, Math.round(top)) + "px";
    };

    dock.append(button, panel, status);
    document.documentElement.append(dock);
    placeDock();
    window.addEventListener("resize", placeDock);
    renderSeg();
  }

  loadPrefs().then(mount);
})();
