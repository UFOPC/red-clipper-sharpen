/* 微博单条（m.weibo.cn/status/<id> 与 /detail/<id>）适配
 *
 * 结构要点（2026-11 实测 5359048358626912 / 5359298311619038）：
 *   正文   .weibo-text（已渲染好的纯文本，话题是 <a>，取 innerText 即可）
 *   作者   .weibo-top .m-text-cut
 *   时间   .weibo-top .time，形如「10-28 17:35」——不带年份，见 parseTime()
 *   配图   .weibo-media-wraps ul.m-auto-list li img.f-bg-img，src 是 orj360/orj480 缩略图
 *   视频   .card-video 里那张是视频封面，不是配图，要排除
 *
 * 图片域名 wx*.sinaimg.cn：无 Referer 回 403；带 https://weibo.com/ 即 200。
 * 把 URL 里的 /orj360/ /orj480/ 换成 /large/ 拿原图（实测 40KB → 111KB）。
 * 页面内 fetch 过不了 CORS，字节仍由后台 fetchMedia 代取（DNR 补 Referer）。
 *
 * 只接移动端单条页：桌面 weibo.com/<uid>/<bid> 是纯 JS 应用、bid 不是数字 id，
 * 要另接一套接口，先不塞进这里。桌面看到想存的微博，点开复制 m.weibo.cn 链接即可。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const STATUS_RE = /^\/(?:status|detail)\/(\d+)\/?$/;
  const SIZE_SEG = /\/(?:orj\d+|thumb\d+|mw\d+|bmiddle|small|square)\//i;

  let media = true;

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function parseTime(raw) {
    const text = squash(raw);
    const full = /(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(text);
    if (full) {
      return new Date(+full[1], +full[2] - 1, +full[3], full[4] ? +full[4] : 0, full[5] ? +full[5] : 0).getTime();
    }
    const short = /(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(text);
    if (short) {
      const now = new Date();
      const month = +short[1];
      /* 微博跨年贴只写「12-31 23:00」；月份比当前月大，说明是去年的 */
      const year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
      return new Date(year, month - 1, +short[2], +short[3], +short[4]).getTime();
    }
    if (/今天|刚刚|分钟前/.test(text)) return Date.now();
    const iso = Date.parse(text);
    return Number.isFinite(iso) ? iso : Date.now();
  }

  /* src 里的尺寸段是 CDN 指令，不是文件名的一部分；换成 large 才是作者上传的那张。 */
  const largeUrl = (raw) => {
    if (!/^https?:\/\//i.test(raw)) return "";
    const upgraded = SIZE_SEG.test(raw) ? raw.replace(SIZE_SEG, "/large/") : raw;
    return upgraded;
  };

  function readStatus() {
    const m = STATUS_RE.exec(location.pathname);
    const textEl = document.querySelector(".weibo-text");
    if (!m || !textEl) return null;

    const body = textEl.innerText.replace(/\n{3,}/g, "\n\n").trim();
    const nick =
      squash(document.querySelector(".weibo-top .m-text-cut")?.textContent) ||
      squash(document.querySelector(".m-text-cut")?.textContent) ||
      "";
    const timeText = squash(document.querySelector(".weibo-top .time, .m-text-box .m-text-desc")?.textContent);

    const images = [
      ...new Set(
        [...document.querySelectorAll(".weibo-media-wraps img[src*='sinaimg.cn']")]
          .filter((img) => !img.closest(".card-video"))
          .map((img) => largeUrl(img.getAttribute("src") || ""))
          .filter(Boolean)
      ),
    ];

    /* 微博没有标题：拿首行前 24 字当目录名，纯图微博退回「作者_微博_id」。 */
    const title = squash(body.split("\n")[0]).replace(/[#＃]/g, "").slice(0, 24) || `${nick}_微博_${m[1]}`;
    const topics = [...body.matchAll(/#([^#\n]{1,30})#/g)].map((x) => squash(x[1])).filter(Boolean);

    return {
      id: m[1],
      title,
      nick,
      timeMs: parseTime(timeText),
      body,
      images,
      topics: [...new Set(topics)],
      url: `https://m.weibo.cn/status/${m[1]}`,
    };
  }

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
  const extOf = (url) => {
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(url).split("?")[0].split("#")[0]);
    return m && /^(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(m[1]) ? "." + m[1].toLowerCase() : ".jpg";
  };

  async function fetchAsDataUrl(url) {
    const result = await chrome.runtime.sendMessage({ type: "fetchMedia", data: { url } });
    if (!result || !result.ok) throw new Error((result && result.error) || "取不到字节");
    if (!/^image\//.test(result.type || "")) throw new Error("不是图片：" + result.type);
    return { url: `data:${result.type};base64,${result.base64}`, ext: extFromMime(result.type) };
  }

  const BATCH = 4;

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const layout = RN.layout(info.title, info.nick, info.timeMs);
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
            /* 退回原地址，让下载器再试一次 */
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

    /* 微博的图不在正文里穿插，统一按出现顺序附在正文末尾。 */
    const refs = names.map((name, i) => (name ? `![${i + 1}](${RN.rel(name)})` : "")).filter(Boolean).join("\n\n");
    let body = info.body;
    if (refs) body += "\n\n" + refs;
    if (mediaError) body += "\n\n> 图片下发中断（" + mediaError + "），正文照存。";

    const md = RN.markdown({
      source: "微博",
      url: info.url,
      title: info.title,
      nick: info.nick,
      timeMs: info.timeMs,
      type: "normal",
      counts: { images: total, videos: 0 },
      noteId: info.id,
      desc: body,
      tags: info.topics,
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
    const info = readStatus();
    if (info) stateEl.textContent = info.images.length + " 张";
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

    slot = document.createElement("div");
    slot.className = "wb-xhx-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "wb-xhx-entry";
    entry.title = "小红虾 · 保存这条微博";
    entry.innerHTML = '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "wb-xhx-panel";
    panel.innerHTML =
      '<div class="wb-xhx-qhead">图片<span class="cnt"></span></div>' +
      '<div class="wb-xhx-seg">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="wb-xhx-actions">' +
      '<button type="button" class="wb-xhx-act">保存</button>' +
      "</div>";

    slot.appendChild(entry);
    slot.appendChild(panel);
    stateEl = panel.querySelector(".wb-xhx-qhead .cnt");

    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = panel.querySelector(".wb-xhx-act");
      if (act && !act.disabled) act.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount();
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });
    for (const btn of panel.querySelectorAll(".wb-xhx-seg button")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        media = btn.dataset.value === "1";
        setPinned(true);
        paint();
      });
    }

    const act = panel.querySelector(".wb-xhx-act");
    act.addEventListener("click", async () => {
      const info = readStatus();
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

  function findAnchor() {
    return document.querySelector(".card-wrap .weibo-og") || document.querySelector(".card-wrap");
  }

  function tick() {
    if (!STATUS_RE.test(location.pathname)) {
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
