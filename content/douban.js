/* 豆瓣（影评 / 书评 / 乐评）适配
 *
 * 结构要点（2026-11 实测 movie.douban.com/review/17890635）：
 *   路径   /review/<id>/，movie / book / music / www 四个子域同一套模板
 *   标题   #content h1 > span
 *   作者   .main-hd a[href*="/people/"]
 *   时间   .main-meta span[content]：content 属性是 yyyy-mm-dd，文本里还带着时分秒
 *   对象   .main-hd a[href*="/subject/"]（评的是哪部电影/哪本书），拿去当 tag
 *   正文   .review-content，子节点是 <p> 与 <div class="image-container">
 *   图片   .image-container img，src 直给（没有懒加载属性），落在 img*.doubanio.com
 *
 * 防盗链：doubanio.com 对「没有 Referer 的请求」回 418（I'm a teapot，0 字节）。
 * 带任意 douban 子域 Referer 就 200（实测 www / movie / book / note 四种都行），
 * 所以规则里统一用 https://www.douban.com/。页面内 fetch 会被 CORS 挡住，
 * 只能让后台代取（静态规则改 Referer）→ data: URL → 下载器，与吾爱破解当初同一条路。
 *
 * 日记（/note/<id>/）要登录才出正文，登出态只剩「某某的日记」列表页，先不接。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const REVIEW_RE = /^\/review\/(\d+)\/?$/;
  const SKIP_IMG = /\/(icon|avatar|upfallback)\//i;
  const UA_REFERER = "https://www.douban.com/";

  let media = true;

  /* ---------- 取数 ---------- */

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function parseTime() {
    const el = document.querySelector(".main-meta span[content]");
    const day = el && el.getAttribute("content");
    const text = squash(el && el.textContent);
    const hm = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
    if (day) {
      const [y, m, d] = day.split("-").map(Number);
      const date = new Date(y, (m || 1) - 1, d || 1, hm ? +hm[1] : 0, hm ? +hm[2] : 0, hm && hm[3] ? +hm[3] : 0);
      if (Number.isFinite(date.getTime())) return date.getTime();
    }
    const iso = Date.parse(text);
    return Number.isFinite(iso) ? iso : Date.now();
  }

  function imageUrl(img) {
    const raw = img.getAttribute("data-original") || img.currentSrc || img.src || "";
    if (!/^https?:\/\//i.test(raw)) return "";
    if (SKIP_IMG.test(raw)) return "";
    return raw;
  }

  function extOf(url) {
    const path = String(url).split("?")[0].split("#")[0];
    const m = /\.([a-z0-9]{2,5})$/i.exec(path);
    const ext = m ? m[1].toLowerCase() : "jpg";
    return /^(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(ext) ? "." + ext : ".jpg";
  }

  /* 正文走一趟，图片在原位留 \u0000N\u0000 占位符，保证 md 里图不乱序。
   * 豆瓣的正文是「<p> + <div.image-container>」交替，偶尔夹引用块和分隔线；
   * 图片容器的 figcaption（图注）跟在图后面当引用行。 */
  function walkBody(root) {
    const parts = [];
    const images = [];
    const seen = new Set();

    const push = (text) => {
      if (text) parts.push(text);
    };

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
        push("\n\n\u0000" + (images.length - 1) + "\u0000\n\n");
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
      else if (tag === "blockquote") push("> ");

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

  function readReview() {
    const m = REVIEW_RE.exec(location.pathname);
    const root = document.querySelector(".review-content");
    if (!m || !root) return null;

    const title = squash(document.querySelector("#content h1 span")?.textContent) ||
      squash(document.querySelector("#content h1")?.textContent);
    if (!title) return null;

    const nick =
      squash(document.querySelector(".main-hd a[href*='/people/']")?.textContent) ||
      squash(document.querySelector(".main-hd .avatar img")?.getAttribute("alt")) ||
      "";
    const subject = squash(document.querySelector(".main-hd a[href*='/subject/']")?.textContent);

    const { text, images } = walkBody(root);

    return {
      id: m[1],
      title,
      nick,
      subject,
      time: parseTime(),
      body: text,
      images,
      url: location.origin + "/review/" + m[1] + "/",
    };
  }

  /* ---------- 抓取与投递 ---------- */

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

  const extFromMime = (type) => MIME_EXT[String(type || "").split(";")[0].trim().toLowerCase()] || "";

  /* 图片字节一律交给后台代取：doubanio 认 Referer，页面内 fetch 又过不了 CORS。
   * 站方给的是 webp（src 里就写着 .webp），扩展名以拿到的 MIME 为准。 */
  async function fetchAsDataUrl(url) {
    const result = await chrome.runtime.sendMessage({ type: "fetchMedia", data: { url } });
    if (!result || !result.ok) throw new Error((result && result.error) || "取不到字节");
    if (!/^image\//.test(result.type || "")) throw new Error("不是图片：" + result.type);
    return { url: `data:${result.type};base64,${result.base64}`, ext: extFromMime(result.type) };
  }

  const BATCH = 4;

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const layout = RN.layout(info.title, info.nick, info.time);
    const total = info.images.length;
    const names = new Array(total);
    let done = 0;
    let mediaError = "";

    try {
      for (let i = 0; i < total && withMedia; i += BATCH) {
        const batch = [];
        for (let j = i; j < Math.min(i + BATCH, total); j++) {
          const origin = info.images[j];
          let url = origin;
          let ext = extOf(origin);
          try {
            const got = await fetchAsDataUrl(origin);
            url = got.url;
            ext = got.ext || ext;
          } catch (e) {
            // 取不到就退回原地址，让下载器再试一次
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
    }

    let body = info.body.replace(/\u0000(\d+)\u0000/g, (_, n) => {
      const name = names[Number(n)];
      return name ? `![${Number(n) + 1}](${RN.rel(name)})` : "";
    });
    if (mediaError) {
      body += "\n\n> 图片下发中断（" + mediaError + "），正文照存，缺的图重存一次即可。";
    }

    const md = RN.markdown({
      source: "豆瓣",
      url: info.url,
      title: info.title,
      nick: info.nick,
      timeMs: info.time,
      type: "normal",
      counts: { images: total, videos: 0 },
      noteId: info.id,
      desc: body,
      tags: info.subject ? [info.subject] : [],
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

  const setPinned = (on) => {
    pinned = !!on;
    if (slot) slot.classList.toggle("is-pinned", on);
  };
  const setOpen = (on) => {
    if (!slot) return;
    slot.classList.toggle("is-open", on);
    if (!on) setPinned(false);
  };

  function refreshCount() {
    if (!stateEl) return;
    const info = readReview();
    if (!info) return;
    stateEl.textContent = info.images.length + " 张";
  }

  function paint() {
    if (!panel) return;
    for (const el of panel.querySelectorAll("button[data-value]")) {
      const on = (el.dataset.value === "1") === media;
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function ensureUI() {
    if (slot) return;

    slot = document.createElement("span");
    slot.className = "db-xhx-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "db-xhx-entry";
    entry.title = "小红虾 · 保存这篇评论";
    entry.innerHTML = '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "db-xhx-panel";
    panel.innerHTML =
      '<div class="db-xhx-qhead">图片<span class="cnt"></span></div>' +
      '<div class="db-xhx-seg">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="db-xhx-actions">' +
      '<button type="button" class="db-xhx-act">保存</button>' +
      "</div>";

    slot.appendChild(entry);
    slot.appendChild(panel);
    stateEl = panel.querySelector(".db-xhx-qhead .cnt");

    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = panel.querySelector(".db-xhx-act");
      if (act && !act.disabled) act.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount();
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });

    for (const btn of panel.querySelectorAll(".db-xhx-seg button")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        media = btn.dataset.value === "1";
        setPinned(true);
        paint();
      });
    }

    const act = panel.querySelector(".db-xhx-act");
    act.addEventListener("click", async () => {
      const info = readReview();
      if (!info || act.disabled) return;
      act.disabled = true;
      const label = act.textContent;
      const withMedia = media;
      try {
        act.textContent = withMedia ? "0/" + info.images.length : "保存中";
        await deliver(info, (d, t) => {
          act.textContent = d + "/" + t;
        }, { withMedia });
        act.textContent = "已提交";
      } catch (e) {
        act.textContent = "失败";
      } finally {
        setTimeout(() => {
          act.disabled = false;
          act.textContent = label;
          setOpen(false);
        }, 900);
      }
    });

    paint();
    refreshCount();
    setTimeout(refreshCount, 2500);
  }

  /* 挂到标题行：豆瓣 h1 只有一行标题，胶囊跟在标题后面最不打眼。 */
  function findAnchor() {
    const h1 = document.querySelector("#content h1");
    if (h1) return h1;
    return document.querySelector(".main-hd");
  }

  function tick() {
    if (!REVIEW_RE.test(location.pathname)) {
      if (slot && slot.parentElement) slot.parentElement.removeChild(slot);
      return;
    }
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

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      tick();
    });
  };

  tick();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
})();
