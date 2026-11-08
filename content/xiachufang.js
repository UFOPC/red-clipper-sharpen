/* 下厨房（xiachufang.com/recipe/<id>/）适配
 *
 * 结构要点（2026-11 用户提供的真实页面快照实测 /recipe/107005387/）：
 *   标题   h1.page-title
 *   作者   .author a
 *   时间   .time「该菜谱发布于 2022-12-31 09:10:02」
 *   简介   .desc
 *   用料   .ings tr > td.name / td.unit
 *   做法   .steps ol > li.container > p.text + img（有的步骤只有文字）
 *   成品图 .recipe-show > .cover img（同块里还有一堆「别人做的」作品图，一律不要）
 *
 * 视频菜谱是**另一套模板**（实测 /recipe/107357520/?recipe_type=1&page_scene=6，
 * 标题尾巴带「的做法视频_做法步骤」）：
 *   iframe.recipe-vod-video   正文主体，src 指向 /vod_video/<n>/
 *   .recipe-show > .cover     同图文模板
 *   .author / .desc / .time   同图文模板
 *   **没有 .steps，也没有 .ings**（用料与步骤都在视频里）
 * 所以 .steps 不能当页面有效的前提，否则这类页面全部「未识别」。
 * 视频不下，只在 md 里留一行回原页的地址。
 *
 * 图片：i2.chuimg.com 的 src 带 ?imageView2/2/w/300/... 缩略指令，剥掉才拿到作者上传的原图
 * （实测 38KB → 68KB）。这个 CDN 对裸请求直接 200，不需要补 Referer，
 * 所以这里不下字节、直接把 URL 交给下载器，与其它三站的防盗链路径不同。
 *
 * 站方有滑块风控，脚本化访问详情页会拿到验证页；开发依据的是用户保存的页面快照，
 * 回归用 test/e2e-xcf-snapshot.mjs 离线跑，不依赖能直连。
 */
(() => {
  const RN = globalThis.__RN;
  if (!RN) return;

  const RECIPE_RE = /^\/recipe\/(\d+)\/?$/;

  let media = true;

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function parseTime(raw) {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw || "");
    if (!m) return Date.now();
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0).getTime();
  }

  /* 只剥 imageView2 开头的转码指令；其它签名类参数原样保留。 */
  function originalUrl(raw) {
    const src = String(raw || "");
    if (!/^https?:\/\//i.test(src)) return "";
    const cut = src.indexOf("?");
    if (cut < 0) return src;
    return /^imageView2\//.test(src.slice(cut + 1)) ? src.slice(0, cut) : src;
  }

  function extOf(url) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(url).split("?")[0].split("#")[0]);
    return m && /^(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(m[1]) ? "." + m[1].toLowerCase() : ".jpg";
  }

  function readRecipe() {
    const m = RECIPE_RE.exec(location.pathname);
    if (!m) return null;
    /* 注意：这里**不能**再把 .steps 当成页面有效的前提。
     * 视频菜谱（/recipe/<id>/?recipe_type=1…）没有 .steps、也没有 .ings，
     * 主体是一段 iframe.recipe-vod-video + 封面 + 简介；
     * 早期写法是 `if (!stepsRoot) return null`，这类页面一律显示「未识别」，
     * 用户看到的是「有胶囊、点了没反应」。判据只留「标题能不能取到」。 */

    const title = squash(document.querySelector("h1.page-title")?.textContent) || squash(document.querySelector("h1")?.textContent);
    if (!title) return null;

    const nick = squash(document.querySelector(".author a")?.textContent) || "";
    const time = parseTime(squash(document.querySelector(".time")?.textContent));
    const desc = squash(document.querySelector(".desc")?.innerText || document.querySelector(".desc")?.textContent);

    const ings = [...document.querySelectorAll(".ings tr")]
      .map((tr) => ({
        name: squash(tr.querySelector("td.name")?.textContent),
        unit: squash(tr.querySelector("td.unit")?.textContent),
      }))
      .filter((row) => row.name);

    /* 图片按「成品图 → 步骤 1 → 步骤 2 …」排，正文里用占位符保住位置。 */
    const images = [];
    const seen = new Set();
    const pushImage = (raw) => {
      const url = originalUrl(raw);
      if (!url || seen.has(url)) return "";
      seen.add(url);
      images.push(url);
      return `\u0000${images.length - 1}\u0000`;
    };

    const cover = pushImage(document.querySelector(".recipe-show > .cover img")?.getAttribute("src"));

    const stepLines = [];
    let stepNo = 0;
    for (const li of document.querySelectorAll(".steps li.container")) {
      const text = squash(li.querySelector("p.text")?.innerText || li.querySelector("p.text")?.textContent);
      const img = li.querySelector("img");
      const holder = img ? pushImage(img.getAttribute("src")) : "";
      if (!text && !holder) continue;
      stepNo++;
      stepLines.push(`${stepNo}. ${text}${holder ? "\n\n" + holder : ""}`);
    }

    const parts = [];
    if (desc) parts.push("## 简介", "", desc, "");
    if (cover) parts.push(cover, "");
    if (ings.length) {
      parts.push("## 用料", "", "| 材料 | 用量 |", "|---|---|");
      for (const row of ings) parts.push(`| ${row.name.replace(/\|/g, "／")} | ${row.unit.replace(/\|/g, "／") || "—"} |`);
      parts.push("");
    }
    if (stepLines.length) parts.push("## 做法", "", stepLines.join("\n\n"), "");
    /* 视频菜谱：正文主体是一段 iframe（/vod_video/<n>/），没有步骤文本。
     * 视频本身不下（要登录、且是流），只留一行能点回原页的地址，
     * 让 md 里明确写着「这篇的正文是视频」，而不是看起来像抓漏了。 */
    const videoEl = document.querySelector("iframe.recipe-vod-video");
    const videoSrc = videoEl ? String(videoEl.getAttribute("src") || "").trim() : "";
    if (videoSrc) {
      const abs = /^https?:/i.test(videoSrc) ? videoSrc : "https://www.xiachufang.com" + (videoSrc.startsWith("/") ? "" : "/") + videoSrc;
      parts.push("## 视频", "", `视频菜谱，原视频见 <${abs}>（本站视频不下，点回原页观看）`, "");
    }

    /* 小贴士不是每个菜谱都有。先定位「小贴士」这个小标题，再取它父容器的文字；
     * 不要直接扫 div 找含「小贴士」的大容器——那会把整页正文都当成提示。 */
    const tipHead = [...document.querySelectorAll("h2,h3,.title,strong")]
      .find((el) => /^小贴士[:：]?$/.test(squash(el.textContent)));
    if (tipHead && tipHead.parentElement) {
      const tip = squash(tipHead.parentElement.innerText).replace(/^小贴士[:：]?\s*/, "");
      if (tip && tip.length < 800) parts.push("## 小贴士", "", tip, "");
    }

    const body = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return {
      id: m[1],
      title,
      nick,
      time,
      body,
      images,
      ings: ings.length,
      steps: stepNo,
      /* 有标题但正文一个字都没拼出来（简介/封面/用料/步骤全缺）= 结构没认出来，
       * 交给 act 显示「未识别」，不要写一份只有 frontmatter 的空 md。 */
      incomplete: !body,
      url: `https://www.xiachufang.com/recipe/${m[1]}/`,
    };

  }

  async function deliver(info, onProgress, options = {}) {
    const withMedia = options.withMedia !== false;
    const layout = RN.layout(info.title, info.nick, info.time);
    const total = info.images.length;
    const names = new Array(total);
    const failedWrite = [];
    let mediaError = "";

    if (withMedia && total) {
      const files = info.images.map((url, i) => {
        const name = RN.mediaPath(layout.mediaStem, i + 1, extOf(url));
        names[i] = name;
        return { filename: layout.prefix + name, url };
      });
      /* 媒体这一跳失败不能把 md 一起带走：老版本这里是裸 await，
       * 结果是一堆孤儿图片 + 一个字都没落盘的 md，用户只能整篇重存。 */
      try {
        const wrote = await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files } });
        /* 单条落盘失败不会抛错（响应里没有 error 字段），必须显式收。 */
        if (wrote && wrote.failed) failedWrite.push(...wrote.failed);
        if (onProgress) onProgress(total, total);
      } catch (e) {
        mediaError = (e && e.message) || String(e);
      }
    }

    let body = info.body.replace(/\u0000(\d+)\u0000/g, (_, n) => {
      const name = names[Number(n)];
      return name ? `![${Number(n) + 1}](${RN.rel(name)})` : "";
    });
    if (mediaError) {
      body += "\n\n> 图片下发中断（" + mediaError + "），正文照存，缺的图重存一次即可。";
    }
    if (failedWrite.length) {
      body += "\n\n> 另有 " + failedWrite.length + " 个文件下载失败：" + RN.writeFailNote(failedWrite) + "。";
    }

    const md = RN.markdown({
      source: "下厨房",
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

    const mdRes = await chrome.runtime.sendMessage({
      type: "downloadFiles",
      data: { files: [{ filename: layout.md, text: md, mime: "text/markdown" }] },
    });
    /* md 自己没落盘时不能写进 md（它根本没落盘，注记等于自欺），只能回传给 UI。 */
    const mdSaved = !(mdRes && mdRes.failed && mdRes.failed.some((f) => f && f.filename === layout.md));
    return { images: withMedia ? total : 0, md: layout.md, mdSaved };
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
    const info = readRecipe();
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

    slot = document.createElement("span");
    slot.className = "xcf-xhx-slot";

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "xcf-xhx-entry";
    entry.title = "小红虾 · 保存这个菜谱";
    entry.innerHTML = '<img src="' + chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span>剪藏</span>';

    panel = document.createElement("div");
    panel.className = "xcf-xhx-panel";
    panel.innerHTML =
      '<div class="xcf-xhx-qhead">图片<span class="cnt"></span></div>' +
      '<div class="xcf-xhx-seg">' +
      '<button type="button" data-value="1">下载</button>' +
      '<button type="button" data-value="0">跳过</button>' +
      "</div>" +
      '<div class="xcf-xhx-actions">' +
      '<button type="button" class="xcf-xhx-act">保存</button>' +
      "</div>";

    slot.appendChild(entry);
    slot.appendChild(panel);
    stateEl = panel.querySelector(".xcf-xhx-qhead .cnt");

    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = panel.querySelector(".xcf-xhx-act");
      if (act && !act.disabled) act.click();
    });
    slot.addEventListener("mouseenter", () => {
      setOpen(true);
      refreshCount();
    });
    slot.addEventListener("mouseleave", () => {
      if (!pinned) setOpen(false);
    });
    for (const btn of panel.querySelectorAll(".xcf-xhx-seg button")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        media = btn.dataset.value === "1";
        setPinned(true);
        paint();
      });
    }

    const act = panel.querySelector(".xcf-xhx-act");
    act.addEventListener("click", async () => {
      if (act.disabled) return;
      /* label 要在「可能提前 return」之前取，否则未识别分支引用不到它。 */
      const label = act.textContent;
      const withMedia = media;
      /* 先把文案从「保存」挪走：readRecipe() 一旦抛异常（未捕获的 rejection），
       * 界面就和「根本没点到」长得一样。现在「…」证明点击生效过。 */
      act.disabled = true;
      act.textContent = "…";
      let hold = 900;
      let info = null;
      try {
        info = readRecipe();
      } catch (e) {
        act.textContent = "失败";
        hold = 4000;
        console.error("[小红虾] 下厨房识别出错", e);
        setTimeout(() => {
          act.disabled = false;
          act.textContent = label;
          setOpen(false);
        }, hold);
        return;
      }
      /* 拿不到 info 和「按钮已禁用」不是一回事：后者是并发保护，前者是模板没认出来
       * （例如页面根本没有 h1，标题取不到 → readRecipe 返回 null）。
       * 以前两者一起 return，用户点一下毫无反应、以为按钮坏了——这是静默无效。
       * 与豆瓣的 incomplete 一个口径：显示「未识别」，4 秒后走同一条还原路径。 */
      if (!info || info.incomplete) {
        act.textContent = "未识别";
        console.warn("[小红虾] 下厨房没认出这篇", {
          path: location.pathname,
          title: !!document.querySelector("h1.page-title") || !!document.querySelector("h1"),
          steps: !!document.querySelector(".steps"),
        });
        setTimeout(() => {
          act.disabled = false;
          act.textContent = label;
          setOpen(false);
        }, 4000);
        return;
      }
      /* md 未落盘时文案要停留久一点，900ms 眨眼就没；成功路径仍是 900ms，逐字不变。 */
      try {
        act.textContent = withMedia ? "0/" + info.images.length : "保存中";
        const result = await deliver(info, (d, t) => {
          act.textContent = d + "/" + t;
        }, { withMedia });
        if (result && result.mdSaved === false) {
          act.textContent = "md 未保存";
          hold = 4000;
        } else {
          act.textContent = "已提交";
        }
      } catch (e) {
        const msg = String((e && e.message) || e);
        /* 上下文失效重试无意义，说「请刷新」比说「失败」有用；判据用真实异常文本。 */
        const stale = /Extension context invalidated|message port closed|Receiving end does not exist/i.test(msg);
        act.textContent = stale ? "请刷新" : "失败";
        /* 失败文案也要能看清：900ms 一闪而过，等于又变回「没反应」。 */
        hold = 4000;
        console.error("[小红虾] 下厨房保存失败", e);
      } finally {
        setTimeout(() => {
          act.disabled = false;
          act.textContent = label;
          setOpen(false);
        }, hold);
      }
    });

    paint();
    refreshCount();
    setTimeout(refreshCount, 2500);
  }

  /* 返回 h1 本身，而不是它的父容器：h1.page-title 的父节点是整篇文章的包裹 div
   * （站方 CSS 下约 7400px 高），appendChild 进去会被塞到正文最后一行之后，
   * 胶囊停在页面底部，用户看不到。 */
  function findAnchor() {
    return document.querySelector("h1.page-title") || document.querySelector("h1") || document.querySelector(".recipe-show");
  }

  function tick() {
    if (!RECIPE_RE.test(location.pathname)) {
      if (slot && slot.parentElement) slot.parentElement.removeChild(slot);
      return;
    }
    const anchor = findAnchor();
    if (!anchor) return;
    ensureUI();
    /* 标题 → 插到它后面；退到 .recipe-show（无 h1 的页面）→ 插到块开头。
     * 同一个 afterend 用在这里会把胶囊落到整个正文块之后，等于换条路径重犯老 bug。
     * 另外 afterend 之后 slot.parentElement 是 h1 的父容器而非 h1，
     * 所以标题那条用前一个兄弟节点判重，否则每 1.5s 重插一次。 */
    if (/^h[1-6]$/i.test(anchor.tagName)) {
      if (slot.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", slot);
    } else if (anchor.firstElementChild !== slot) {
      anchor.insertAdjacentElement("afterbegin", slot);
    }
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
