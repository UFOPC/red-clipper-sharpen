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
    const stepsRoot = document.querySelector(".steps");
    if (!m || !stepsRoot) return null;

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

    /* 小贴士不是每个菜谱都有。先定位「小贴士」这个小标题，再取它父容器的文字；
     * 不要直接扫 div 找含「小贴士」的大容器——那会把整页正文都当成提示。 */
    const tipHead = [...document.querySelectorAll("h2,h3,.title,strong")]
      .find((el) => /^小贴士[:：]?$/.test(squash(el.textContent)));
    if (tipHead && tipHead.parentElement) {
      const tip = squash(tipHead.parentElement.innerText).replace(/^小贴士[:：]?\s*/, "");
      if (tip && tip.length < 800) parts.push("## 小贴士", "", tip, "");
    }

    return {
      id: m[1],
      title,
      nick,
      time,
      body: parts.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      images,
      ings: ings.length,
      steps: stepNo,
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
      const info = readRecipe();
      if (!info || act.disabled) return;
      act.disabled = true;
      const label = act.textContent;
      const withMedia = media;
      /* md 未落盘时文案要停留久一点，900ms 眨眼就没；成功路径仍是 900ms，逐字不变。 */
      let hold = 900;
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
        act.textContent = "失败";
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
    /* 插到标题之后，而不是塞进标题里，也不是挂到它的父容器上：
     *   进 h1  → h1.textContent 会把面板文案带进标题（豆瓣踩过这个坑）；
     *   进父容器 → 那是约 7400px 高的包裹层，胶囊直接跑到页面底部。
     * afterend 之后 slot.parentElement 是 h1 的父容器而非 h1，所以这里用
     * 前一个兄弟节点判重，否则「父节点不是 anchor」永远成立、每 1.5s 重插一次。 */
    if (slot.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", slot);
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
