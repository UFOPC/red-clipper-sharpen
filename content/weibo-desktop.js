/* 微博桌面版单条（weibo.com/detail/<mid>）适配
 *
 * 桌面版正文区类名随构建变化，不依赖 DOM 取正文；数据只走页面同源接口：
 *   /ajax/statuses/show?id=<mid>       正文、作者、时间、配图、转发
 *   /ajax/statuses/longtext?id=<mid>   isLongText 时的完整正文
 * 请求带当前页面 cookie；接口失败就显示失败，一个文件都不下发。
 *
 * 图片仍由后台 fetchMedia 代取：sinaimg.cn 裸请求会被防盗链拦截，
 * DNR 的 Referer 规则与 host_permissions 复用移动版配置。
 *
 * 本期只做数字 mid 的 /detail/ 页；/<uid>/<bid> 不做 bid → mid 换算。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const DETAIL_RE = /^\/detail\/(\d+)\/?$/;
  const BATCH = 4;
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

  let media = true;
  let slot = null;
  let panel = null;
  let stateEl = null;
  let pinned = false;
  let infoMid = "";
  let infoPromise = null;

  const currentMid = () => {
    const matched = DETAIL_RE.exec(location.pathname);
    return matched ? matched[1] : "";
  };
  const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const cleanText = (value) =>
    String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  /* 长文接口可能给 HTML。DOMParser 的文档是惰性的，不执行脚本、不主动加载图片；
   * 只取文字与换行，避免把接口返回的标记直接塞进 Markdown。 */
  function richTextToText(raw) {
    const text = String(raw || "");
    if (!/<[a-z][\s\S]*>/i.test(text)) return cleanText(text);
    const doc = new DOMParser().parseFromString(text, "text/html");
    for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
    for (const block of doc.querySelectorAll("p,div")) block.append("\n");
    return cleanText(doc.body ? doc.body.textContent : "");
  }

  const extFromMime = (type) => MIME_EXT[String(type || "").split(";")[0].trim().toLowerCase()] || "";
  const extOf = (url) => {
    const matched = /\.([a-z0-9]{2,5})$/i.exec(String(url).split("?")[0].split("#")[0]);
    return matched && /^(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(matched[1])
      ? "." + matched[1].toLowerCase()
      : ".jpg";
  };

  async function fetchAsDataUrl(url) {
    const result = await chrome.runtime.sendMessage({ type: "fetchMedia", data: { url } });
    if (!result || !result.ok) throw new Error((result && result.error) || "取不到字节");
    if (!/^image\//.test(result.type || "")) throw new Error("不是图片：" + result.type);
    return { url: `data:${result.type};base64,${result.base64}`, ext: extFromMime(result.type) };
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (!data || data.ok === 0) throw new Error("接口未返回微博");
    return data;
  }

  const picUrl = (pic) => {
    const url = (pic && pic.large && pic.large.url) || (pic && pic.url) || "";
    return /^https?:\/\//i.test(url) ? url : "";
  };
  const picsOf = (status) => ((status && status.pics) || []).map(picUrl).filter(Boolean);

  async function readStatus(mid) {
    const data = await fetchJson(
      "https://weibo.com/ajax/statuses/show?id=" + encodeURIComponent(mid) + "&locale=zh-CN"
    );

    let text = richTextToText(data.text_raw);
    let longTextMissing = false;
    if (data.isLongText) {
      try {
        const longData = await fetchJson("https://weibo.com/ajax/statuses/longtext?id=" + encodeURIComponent(mid));
        const fullText = richTextToText(longData.longText && longData.longText.longTextContent);
        if (fullText) text = fullText;
        else longTextMissing = true;
      } catch (e) {
        /* 长文取不到只能退回 text_raw，但必须留痕，不能把截断版当完整正文。 */
        longTextMissing = true;
      }
    }

    const nick = squash(data.user && data.user.screen_name);
    const parsedTime = Date.parse(String(data.created_at || ""));
    const timeMs = Number.isFinite(parsedTime) ? parsedTime : Date.now();
    /* 微博没有标题：首行前 24 字作目录名，纯图微博退回「作者_微博_mid」。 */
    const title = squash(text.split("\n")[0]).replace(/[#＃]/g, "").slice(0, 24) || `${nick}_微博_${mid}`;

    let body = text;
    const retweeted = data.retweeted_status;
    if (retweeted) {
      const originalNick = squash(retweeted.user && retweeted.user.screen_name) || "原作者";
      if (retweeted.deleted) {
        body += `\n\n> 转发自 @${originalNick}：原帖已删除。`;
      } else {
        const originalText = richTextToText(retweeted.text_raw);
        body += `\n\n> 转发自 @${originalNick}：${originalText.replace(/\n/g, "\n> ")}`;
      }
    }
    if (longTextMissing) body += "\n\n> 长文接口未取到，正文可能被截断。";
    if (data.page_info && data.page_info.type === "video") body += "\n\n> 本条含视频，未保存。";

    const images = [...new Set([...picsOf(data), ...(retweeted && !retweeted.deleted ? picsOf(retweeted) : [])])];
    const topics = [...body.matchAll(/#([^#\n]{1,30})#/g)].map((item) => squash(item[1])).filter(Boolean);

    return {
      id: mid,
      title,
      nick,
      timeMs,
      body,
      images,
      topics: [...new Set(topics)],
      url: `https://weibo.com/detail/${mid}`,
    };
  }

  function loadInfo(mid) {
    if (!infoPromise || infoMid !== mid) {
      infoMid = mid;
      const pending = readStatus(mid);
      infoPromise = pending;
      /* 只缓存成功结果；失败时清掉，网络恢复后用户可再点一次，不必刷新页面。 */
      pending.catch(() => {
        if (infoPromise === pending) {
          infoPromise = null;
          infoMid = "";
        }
      });
    }
    return infoPromise;
  }

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const layout = RN.layout(info.title, info.nick, info.timeMs);
    const total = info.images.length;
    const names = new Array(total);
    const failedFetch = [];
    const failedWrite = [];
    let done = 0;
    let mediaError = "";

    try {
      for (let i = 0; i < total && withMedia; i += BATCH) {
        const batch = [];
        for (let j = i; j < Math.min(i + BATCH, total); j++) {
          const origin = info.images[j];
          let ext = extOf(origin);
          let url;
          try {
            const got = await fetchAsDataUrl(origin);
            url = got.url;
            ext = got.ext || ext;
          } catch (e) {
            /* 取不到字节的图不写死引用：sinaimg 裸地址交给下载器仍可能被防盗链拦截。 */
            failedFetch.push({ no: j + 1, error: (e && e.message) || String(e) });
            continue;
          }
          names[j] = RN.mediaPath(layout.mediaStem, j + 1, ext);
          batch.push({ filename: layout.prefix + names[j], url });
        }
        if (batch.length) {
          const res = await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: batch } });
          if (res && res.failed) failedWrite.push(...res.failed);
        }
        done += batch.length;
        if (onProgress) onProgress(done, total);
      }
    } catch (e) {
      mediaError = (e && e.message) || String(e);
    }

    /* 桌面版与移动版一致：配图按本条、原帖的顺序统一附在正文末尾。 */
    const refs = names.map((name, index) => (name ? `![${index + 1}](${RN.rel(name)})` : "")).filter(Boolean).join("\n\n");
    let body = info.body;
    if (refs) body += "\n\n" + refs;
    if (mediaError) body += "\n\n> 图片下发中断（" + mediaError + "），正文照存。";
    if (failedFetch.length) body += "\n\n> " + RN.fetchFailNote(failedFetch) + "，未写入引用。";
    if (failedWrite.length) {
      body += "\n\n> 另有 " + failedWrite.length + " 个文件下载失败：" + RN.writeFailNote(failedWrite) + "。";
    }

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

    const mdRes = await chrome.runtime.sendMessage({
      type: "downloadFiles",
      data: { files: [{ filename: layout.md, text: md, mime: "text/markdown" }] },
    });
    /* md 自己没落盘时不能写进 md，只能回传给 UI。 */
    const mdSaved = !(mdRes && mdRes.failed && mdRes.failed.some((file) => file && file.filename === layout.md));
    return { images: withMedia ? total : 0, md: layout.md, mdSaved };
  }

  /* ---------- UI：固定浮层，不依赖页面构建哈希类名 ---------- */

  const setPinned = (on) => {
    pinned = !!on;
    if (slot) slot.classList.toggle("is-pinned", pinned);
  };
  const setOpen = (on) => {
    if (!slot) return;
    slot.classList.toggle("is-open", on);
    if (!on) setPinned(false);
  };

  function paint() {
    if (!panel) return;
    for (const button of panel.querySelectorAll("button[data-value]")) {
      const on = (button.dataset.value === "1") === media;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  async function refreshCount(mid) {
    if (!stateEl) return;
    try {
      const info = await loadInfo(mid);
      if (stateEl && currentMid() === mid) stateEl.textContent = info.images.length + " 张";
    } catch (e) {
      if (stateEl && currentMid() === mid) stateEl.textContent = "读取失败";
    }
  }

  function ensureUI(mid) {
    if (slot) return;

    slot = document.createElement("div");
    slot.className = "wbd-xhx-slot wb-xhx-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "wb-xhx-entry";
    entry.title = "小红虾 · 保存这条微博";
    entry.innerHTML = '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "wb-xhx-panel";
    panel.innerHTML =
      '<div class="wb-xhx-qhead">图片<span class="cnt">读取中</span></div>' +
      '<div class="wb-xhx-seg">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="wb-xhx-actions"><button type="button" class="wb-xhx-act">保存</button></div>';

    slot.appendChild(entry);
    slot.appendChild(panel);
    stateEl = panel.querySelector(".wb-xhx-qhead .cnt");

    entry.addEventListener("click", (event) => {
      event.stopPropagation();
      const act = panel.querySelector(".wb-xhx-act");
      if (act && !act.disabled) act.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount(mid);
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });
    for (const button of panel.querySelectorAll(".wb-xhx-seg button")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        media = button.dataset.value === "1";
        setPinned(true);
        paint();
      });
    }

    const act = panel.querySelector(".wb-xhx-act");
    act.addEventListener("click", async () => {
      if (act.disabled || currentMid() !== mid) return;
      act.disabled = true;
      const label = act.textContent;
      const withMedia = media;
      let hold = 900;
      try {
        act.textContent = "读取中";
        const info = await loadInfo(mid);
        act.textContent = withMedia ? "0/" + info.images.length : "保存中";
        const result = await deliver(
          info,
          (done, total) => {
            act.textContent = done + "/" + total;
          },
          { withMedia }
        );
        if (result && result.mdSaved === false) {
          act.textContent = "md 未保存";
          hold = 4000;
        } else {
          act.textContent = "已提交";
        }
      } catch (e) {
        /* show/longtext 的必要数据没拿到时在上方已经抛出，不会进入 deliver。 */
        act.textContent = "失败";
        hold = 4000;
      } finally {
        setTimeout(() => {
          act.disabled = false;
          act.textContent = label;
          setOpen(false);
        }, hold);
      }
    });

    document.body.appendChild(slot);
    paint();
    refreshCount(mid);
  }

  function removeUI() {
    if (slot && slot.parentElement) slot.parentElement.removeChild(slot);
    slot = null;
    panel = null;
    stateEl = null;
    pinned = false;
    infoMid = "";
    infoPromise = null;
  }

  function tick() {
    const mid = currentMid();
    if (!mid || !document.body) {
      removeUI();
      return;
    }
    ensureUI(mid);
  }

  document.addEventListener("click", (event) => {
    if (slot && !slot.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  tick();
  /* SPA 站内跳转不重新加载 content script，轻量轮询只负责路径守卫与浮层增删。 */
  setInterval(tick, 1500);
})();
