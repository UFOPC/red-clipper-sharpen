(() => {
  let cancelled = true;

  async function ask(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response && response.error) throw new Error(response.error);
    return response;
  }

  function currentNoteId() {
    const match = location.pathname.match(/\/explore\/([^/]+)(\/.*)*/i);
    return match ? match[1] : null;
  }

  function containersFor(downloadId) {
    return [...document.querySelectorAll(".xhx-download-container")]
      .filter((container) => container.dataset.id === String(downloadId));
  }

  function setDownloading(downloadId, downloading) {
    cancelled = !downloading;
    for (const container of containersFor(downloadId)) {
      container.classList.toggle("xhx-hide", downloading);
    }
  }

  /* 小红书的胶囊没有独立状态位（index.css 里也没有 error 类），
   * 所以直接把胶囊文字临时换掉再还原——零新增节点、零新增 CSS 规则。 */
  function showBrandText(container, text) {
    const label = container.querySelector(".xhx-brand-text");
    if (!label) return;
    if (!label.dataset.label) label.dataset.label = label.textContent;
    label.textContent = text;
    setTimeout(() => {
      label.textContent = label.dataset.label;
    }, 4000);
  }

  /* 条数来自后台返回的 res.failed，取消不算失败。 */
  function showWriteFailure(container, count) {
    showBrandText(container, "失败 " + count);
  }

  function wait(ms = 600) {
    return new Promise((resolve, reject) => {
      setTimeout(() => cancelled ? reject(new Error("cancel by user")) : resolve(), ms);
    });
  }

  async function expandAllComments() {
    const scroller = document.querySelector(".note-scroller");
    if (!scroller || scroller.querySelector(".no-comments")) return;
    const comments = scroller.querySelector(".comments-el");
    if (!comments) return;

    let remaining = 50;
    while (!scroller.querySelector(".end-container") && remaining-- > 0) {
      scroller.scrollTop += comments.clientHeight + 1000;
      await wait();
      scroller.scrollTop -= 400;
      await wait(60);
    }

    remaining = 1000;
    let showMore = document.querySelectorAll(".show-more");
    while (showMore.length && remaining-- > 0) {
      showMore.forEach((button) => button.click());
      if (showMore[0].scrollIntoViewIfNeeded) showMore[0].scrollIntoViewIfNeeded();
      else showMore[0].scrollIntoView();
      await wait();
      showMore = document.querySelectorAll(".show-more");
    }
  }

  async function onDownloadClick(event) {
    const container = event.target.closest(".xhx-download-container");
    if (!container) return;
    const downloadId = container.dataset.id;
    if (!downloadId) return;

    // 单击已经开工，双击的第二下不能被误判为取消。
    const now = Date.now();
    if (container.dataset.t0 && now - Number(container.dataset.t0) < 400) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    container.dataset.t0 = String(now);

    if (container.classList.contains("xhx-hide")) {
      event.preventDefault();
      event.stopPropagation();
      setDownloading(downloadId, false);
      ask({ type: "cancel" }).catch(() => {});
      return;
    }

    const withComment = !!event.target.closest(".xhx-download-with-comment");
    const loggedOut = !!document.querySelector(".note-scroller .comments-login");
    setDownloading(downloadId, true);
    setTimeout(injectOnce, 300);

    let writeFailed = 0;
    let writeError = false;
    try {
      if (withComment && !loggedOut) await expandAllComments();
      await ask({ type: "clearData" });
      if (cancelled) return;
      await ask({
        type: "saveData",
        downloadId,
        withComment,
        rnOnly: true,
        videoUrl: container.dataset.videoUrl || "",
        skipMedia: container.dataset.media === "0",
      });
      if (!cancelled) {
        /* 后台返回 { done, failed, cancelled }；单条落盘失败**不会**让 ask() 抛错
         * （响应里没有 error 字段），必须自己看 failed。
         * 取消保持静默恢复，不当错误弹。 */
        const res = await ask({ type: "download", downloadId });
        if (res && res.failed && res.failed.length && !res.cancelled) writeFailed = res.failed.length;
      }
    } catch (error) {
      /* 抛错 ≠ 取消。取消是用户按的，cancelled 已置位，静默恢复按钮就行；
       * 其余（扩展刚重载导致端口失效、后台回 error、页面结构变了）以前一律吞掉，
       * 于是「什么都没存」和「存好了」在界面上一模一样：按钮转一圈又变回「剪藏」。
       * 这里只认 cancelled，其余一定留话。 */
      if (!cancelled) {
        writeError = true;
        console.warn("小红虾 · 保存中断", error);
      }
    } finally {
      setDownloading(downloadId, false);
      // 放在按钮恢复显示之后再说，否则提示就写在隐藏状态里，用户看不见
      if (writeFailed) showWriteFailure(container, writeFailed);
      else if (writeError) showBrandText(container, "失败");
    }
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.className = "xhx-download-more";
    panel.innerHTML = '<div class="xhx-quality" hidden><div class="xhx-qhead">视频清晰度</div><div class="xhx-opts"></div></div>' +
      '<div class="xhx-photo-row" hidden><div class="xhx-photo-key">图片<span class="cnt"></span></div>' +
      '<div class="xhx-photo-seg"><button type="button" data-value="1">下载</button><button type="button" data-value="0">跳过</button></div></div>' +
      '<div class="xhx-divider"></div>' +
      '<div class="xhx-download-direct xhx-download-btn xhx-act-primary">正文</div>' +
      '<div class="xhx-act-row"><div class="xhx-download-direct xhx-download-with-comment xhx-download-btn xhx-act-ghost" title="带上评论">正文+回复</div></div>' +
      '<div class="xhx-origin-slot"></div>';
    return panel;
  }

  function createProgress() {
    const progress = document.createElement("div");
    progress.className = "xhx-load";
    progress.innerHTML = '<div class="xhx-loading">' + '<div class="xhx-obj"></div>'.repeat(6) + '</div>';
    return progress;
  }

  async function probeSize(url) {
    const controller = new AbortController();
    try {
      const response = await fetch(url, { signal: controller.signal });
      return Number(response.headers.get("Content-Length")) || 0;
    } finally {
      // 只需要响应头，拿到后立即中止响应体传输。
      controller.abort();
    }
  }

  async function probeOriginalVideo(container, panel, noteContainer, noteId) {
    const video = noteContainer.querySelector(".player-container video") || noteContainer.querySelector(".media-container video[src]");
    if (!video || container.dataset.videoProbed || container.querySelector(".xhx-download-video")) return;
    container.dataset.videoProbed = "1";

    const note = await ask({ type: "getNote", downloadId: noteId });
    const key = note && note.video && note.video.consumer && note.video.consumer.originVideoKey;
    if (!key) return;

    const RN = window.__RN;
    const nick = note.user && note.user.nickname || "";
    const title = note.title || "";
    const timeMs = note.time || note.lastUpdateTime;
    const layout = RN.layout(title, nick, timeMs);
    const mediaPath = RN.mediaPath(layout.mediaStem, 1, ".mp4", true);
    const url = "https://sns-video-hw.xhscdn.com/" + key;
    const markdown = RN.markdown({
      title,
      nick,
      timeMs,
      type: note.type,
      noteId: note.noteId || noteId,
      desc: note.desc || "",
      tags: (note.tagList || []).map((tag) => tag.name),
      media: [{ path: "./" + mediaPath, video: true }],
    });

    const button = document.createElement("div");
    button.title = "下载无水印原始视频";
    button.className = "xhx-download-direct xhx-download-video xhx-download-btn xhx-act-ghost";
    button.textContent = "原视频";
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ask({
        type: "downloadUrl",
        data: { url, filename: layout.prefix + mediaPath, mdFilename: layout.md, md: markdown },
      }).catch(() => {});
    };
    const block = document.createElement("div");
    block.className = "xhx-origin-block";
    block.appendChild(button);
    panel.querySelector(".xhx-origin-slot").appendChild(block);

    probeSize(url).then((size) => {
      if (!size) return;
      const info = document.createElement("div");
      info.className = "xhx-download-video-info";
      info.textContent = filesize.filesize(size);
      button.appendChild(info);
    }).catch(() => {});
  }

  function paintPhotoButtons(container, row) {
    const downloadMedia = container.dataset.media !== "0";
    row.querySelectorAll("button").forEach((button) => {
      const selected = (button.dataset.value === "1") === downloadMedia;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function fillPhotoPanel(container, panel, note) {
    panel.classList.add("is-photo");
    const row = panel.querySelector(".xhx-photo-row");
    const images = note && Array.isArray(note.imageList) ? note.imageList.filter((image) => image && image.width) : [];
    row.hidden = false;
    row.querySelector(".cnt").textContent = images.length ? images.length + " 张" : "无";
    if (!container.dataset.media) container.dataset.media = "1";
    row.querySelectorAll("button").forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        container.dataset.media = button.dataset.value;
        paintPhotoButtons(container, row);
      };
    });
    paintPhotoButtons(container, row);
  }

  /* 档位列表进面板。只有一档时也照样画一行——早先为了「不显示只有一项的单选」直接不画，
   * 结果面板看起来跟图文贴一模一样，用户以为没识别到视频。一行也画，至少能看出视频被认出来了。 */
  function renderQuality(container, panel, list, defaultIndex) {
    const quality = panel.querySelector(".xhx-quality");
    const options = panel.querySelector(".xhx-opts");
    quality.hidden = false;
    options.innerHTML = "";

    list.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "xhx-opt" + (index === defaultIndex ? " is-on" : "");
      row.innerHTML = '<span class="dot"></span><span class="txt"><span class="res"></span><span class="size"></span></span>';
      row.querySelector(".res").textContent = item.res;
      row.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.querySelectorAll(".xhx-opt").forEach((option) => option.classList.remove("is-on"));
        row.classList.add("is-on");
        container.dataset.videoUrl = index === 0 ? "" : item.url;
        container.classList.add("is-pinned");
      };
      options.appendChild(row);
      if (!item.url) return;
      probeSize(item.url).then((size) => {
        if (!size) return;
        const readable = filesize.filesize(size);
        row.title = readable;
        row.querySelector(".size").textContent = readable;
      }).catch(() => {});
    });

    // 非第 0 档必须显式传 URL，否则后台仍会自行选择最大档。
    container.dataset.videoUrl = defaultIndex > 0 && list[defaultIndex].url ? list[defaultIndex].url : "";
  }

  async function fillQuality(container, panel, noteId) {
    if (container.dataset.qLoaded) return;
    container.dataset.qLoaded = "1";
    const note = await ask({ type: "getNote", downloadId: noteId });
    const RN = window.__RN;
    const isVideo = !!(note && (note.type === "video" || note.video));
    const stream = note && note.video && note.video.media && note.video.media.stream;
    const list = RN && RN.videoOptions ? RN.videoOptions(stream) : [];

    if (!list.length) {
      /* 视频贴但一档都摊不出来（stream 结构变了、或页面还没把播放地址补进来）：
       * 仍然显示「视频清晰度 / 原始画质」，让用户看见已识别为视频；保存时后台自己挑最高档。 */
      if (isVideo) {
        renderQuality(container, panel, [{ res: "原始画质", url: "" }], 0);
        return;
      }
      fillPhotoPanel(container, panel, note);
      return;
    }
    renderQuality(container, panel, list, Math.max(0, RN.pickDefaultQuality ? RN.pickDefaultQuality(list) : 0));
  }

  /* 小红书的作者行是 space-between：我们插进去的胶囊算第三个 flex 项，
   * 于是「关注 ↔ 胶囊」的间距由剩余空间平分，作者名长短一变就忽远忽近。
   * 量一次实际间距，用 margin-left 把它拉回固定值；space-between 会吃掉一半修正，
   * 所以迭代几轮收敛，不假设站点用哪种排布。 */
  function pinGap(container) {
    const mount = container.parentElement;
    if (!mount) return;
    /* 取最宽的那个匹配项：<button><span>关注</span></button> 会同时命中两层，
     * 只有外层才是那颗胶囊的边界，按内层文字量会把间距算大一圈。 */
    let follow = null;
    for (const el of mount.querySelectorAll("button, a, div, span")) {
      const text = (el.textContent || "").trim();
      if (text !== "关注" && text !== "已关注") continue;
      if (!el.offsetWidth) continue;
      if (!follow || el.offsetWidth > follow.offsetWidth) follow = el;
    }
    if (!follow) return;

    /* 间距对 margin 是仿射的：flex-end 下 1:1，space-between 下只有 1/2（另一半被另一个间隙吃掉）。
     * 所以先测两点求斜率，再解一次，而不是慢慢逼近——按固定步长逼近在 space-between 下误差会被放大 1.5 倍。
     *
     * 测量期间必须关掉过渡：胶囊上有 transition: all .2s，改完 margin 当场读 rect 拿到的还是旧位置，
     * 探针会测出斜率 0，然后以为自己算不出来直接放弃。 */
    const transition = container.style.transition;
    container.style.transition = "none";
    try {
      const target = 8;
      const put = (margin) => {
        container.style.marginLeft = margin + "px";
        return container.getBoundingClientRect().left - follow.getBoundingClientRect().right;
      };
      const gap0 = put(0);
      if (Math.abs(gap0 - target) <= 1) return;
      const probe = 20;
      const slope = (put(probe) - gap0) / probe;
      if (Math.abs(slope) < 0.05) {
        container.style.marginLeft = "";
        return;
      }
      let margin = (target - gap0) / slope;
      const gap1 = put(margin);
      if (Math.abs(gap1 - target) > 1) {
        // 字体重排/亚像素会让实际斜率略有偏差，按同一斜率再校一次就够
        margin += (target - gap1) / slope;
        put(margin);
      }
    } finally {
      // 先让最终位置落定，再放开过渡，否则恢复过渡的那一刻会把刚对齐的位移又滑一遍
      void container.offsetWidth;
      container.style.transition = transition;
    }
  }

  function injectOnce() {
    if (!location.pathname.startsWith("/explore")) return;
    const noteId = currentNoteId();
    const noteContainer = document.querySelector(".note-container");
    if (!noteId || !noteContainer) return;
    const mount = noteContainer.querySelector(".interaction-container .author-wrapper");
    /* 用 querySelector 而不是 innerHTML.includes：后者每 300ms 对整棵笔记 DOM
     * （含已展开的全部评论）做一次字符串序列化，评论多的笔记等于常驻十几个点的 CPU。 */
    if (!mount || noteContainer.querySelector('.xhx-download[data-id="' + noteId + '"]')) return;

    const container = document.createElement("div");
    container.className = "xhx-download xhx-download-container xhx-download-btn xhx-download-" + noteId;
    container.title = "小红虾 · 下载这篇笔记";
    container.dataset.id = noteId;
    container.style.position = "relative";
    container.style.display = "none";
    container.innerHTML = '<span class="xhx-download-main"><img class="xhx-brand-icon" src="' +
      chrome.runtime.getURL("icons/icon.svg") + '" alt=""><span class="xhx-brand-text">剪藏</span></span>';
    const panel = createPanel();
    container.appendChild(panel);
    container.appendChild(createProgress());
    container.onclick = onDownloadClick;
    container.onmouseenter = () => {
      pinGap(container);
      fillQuality(container, panel, noteId).catch(() => {});
      probeOriginalVideo(container, panel, noteContainer, noteId).catch(() => {});
    };
    mount.appendChild(container);
    pinGap(container);
  }

  function inject() {
    injectOnce();
    setTimeout(inject, 300);
  }

  document.addEventListener("click", (event) => {
    if (event.target && event.target.closest && event.target.closest(".xhx-download-container")) return;
    document.querySelectorAll(".xhx-download.is-pinned").forEach((container) => container.classList.remove("is-pinned"));
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
