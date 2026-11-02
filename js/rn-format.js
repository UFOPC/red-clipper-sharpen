/* Rednote-Sharpen 命名与 Markdown 规范（供 background service worker 与 content scripts 共用）
 * 目录：<作者>/<标题>/
 * 文件：<YYYY.MM.DD_标题_作者>.md；媒体 <stem>-N.ext；评论 <stem>-comments.json（全部平铺在该目录下，无子目录）
 * MD：frontmatter(来源/作者/时间/类型/链接/tags) + # 标题 + 正文 + ![N](./N.ext)；视频同用图片语法，Obsidian 按扩展名渲染成可播放的播放器
 */
(() => {
  const CONTROL = /[\x00-\x1F\x7F]/g;
  const ZERO = /[\u200B-\u200D\uFEFF]/g;
  const RESERVED = /[/\\|<>"?*]/g;
  const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu;
  const MODIFIER = /\p{Emoji_Modifier}/gu;

  // 对齐 REDnote-Downloader Cleaner.filter_name 的过滤规则
  function name(value) {
    let text = String(value == null ? "" : value);
    text = text.replace(/:/g, ".");
    text = text.replace(CONTROL, "");
    text = text.replace(ZERO, "");
    text = text.replace(RESERVED, "");
    text = text.replace(EMOJI, "");
    text = text.replace(MODIFIER, "");
    text = text.replace(/[\t\n\r\v\f]/g, "");
    text = text.replace(/\s+/g, " ").trim();
    text = text.replace(/^\.+/, "").replace(/\.+$/, "");
    text = text.replace(/^_+/, "").replace(/_+$/, "");
    return text;
  }

  const pad = (n) => (n < 10 ? "0" + n : String(n));

  function dateParts(ms) {
    const value = Number(ms);
    const d = new Date(Number.isFinite(value) && value > 0 ? value : Date.now());
    const date = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return { date, time };
  }

  function base(title, nick, ms) {
    return [dateParts(ms).date, name(title), name(nick)].filter(Boolean).join("_");
  }

  function dir(title, nick) {
    return [name(nick), name(title)].filter(Boolean).join("/");
  }

  /* md 里的相对路径必须写成合法 URI，否则渲染器不认。
   * 标题带空格时文件名也跟着带（name() 只把连续空白压成一个，不会删掉），而 CommonMark
   * 的链接目标遇到空格就截断——`![1](./2026.08.03_S101 峡谷_张三-1.png)` 会原样显示成文字，
   * 图片一张都不出来。实测 markdown-it/CommonMark 都是这个行为，改成 %20 或 <...> 才认。
   * 这里只转义会破坏目标的那几个字符，中文和全角标点保持可读。 */
  const REL_UNSAFE = /[ %#?()<>[\]"'`\\]/g;
  /* 不能用 encodeURIComponent：它对 ( ) ' ! * 一个都不转，括号留下照样把链接拆坏 */
  const relEscape = (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");

  function rel(path) {
    const clean = String(path == null ? "" : path).replace(/^\.\//, "");
    return "./" + clean.replace(REL_UNSAFE, relEscape);
  }

  function commentLines(list) {
    const out = [];
    let count = 0;
    for (const c of list) {
      if (count >= 300) break;
      count++;
      const user = name(c && c.user && c.user.username) || "";
      const text = String((c && c.content) || "").replace(/\s*\n\s*/g, " ").trim();
      out.push(`${count}. **${user}**: ${text}`);
      for (const sub of (c && c.subComments) || []) {
        if (count >= 300) break;
        count++;
        const su = name(sub && sub.user && sub.user.username) || "";
        const st = String((sub && sub.content) || "").replace(/\s*\n\s*/g, " ").trim();
        out.push(`   - **${su}**: ${st}`);
      }
    }
    if (count >= 300) out.push("", "......");
    return out;
  }

  /* 把 note.video.media.stream 摊平成可选档位表。
   * 规则与 background 内联选择器一致：摊平各编码 → 按「宽x高」去重（同分辨率留码率高的）→ 像素降序。
   * 排序键里的 rank 必须与 background 的 avgBitrate||videoBitrate||bitrate||size 链保持同序，
   * 否则「默认档」会和「不选时后台自己挑的那档」不是同一个 URL。
   */
  function videoOptions(stream) {
    const list = stream && typeof stream === "object" ? stream : {};
    const seen = Object.create(null);
    const out = [];
    for (const codec of Object.keys(list)) {
      const arr = list[codec];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item) continue;
        const url = item.masterUrl || (Array.isArray(item.backupUrls) ? item.backupUrls[0] : "") || "";
        if (!url) continue;
        const width = Number(item.width) || 0;
        const height = Number(item.height) || 0;
        const px = width * height;
        const rank =
          Number(item.avgBitrate) || Number(item.videoBitrate) || Number(item.bitrate) || Number(item.size) || 0;
        const key = px > 0 ? width + "x" + height : "u:" + url;
        const prev = seen[key];
        if (prev) {
          if (rank > prev.rank) {
            prev.url = url;
            prev.rank = rank;
          }
          continue;
        }
        const entry = { url, width, height, px, rank };
        seen[key] = entry;
        out.push(entry);
      }
    }
    out.sort((a, b) => b.px - a.px || b.rank - a.rank);
    return out.map((e) => ({
      url: e.url,
      width: e.width,
      height: e.height,
      res: e.px > 0 ? e.width + "×" + e.height : "未知尺寸",
    }));
  }

  /* 类型看「这条笔记里到底有什么」，而不是站方声明的作品形态。
   *   有图有视频 → 图文+视频   值得买好文、Chiphell 帖子夹一段站内视频就是这种
   *   只有视频   → 视频
   *   只有图     → 图文
   *   一个媒体都没有（纯文字贴）→ 退回站方口径，别把正常笔记写成空
   * counts 数的是笔记本身有几个图几段视频，不是这次下载了几个 ——
   * 用户在面板上点「跳过」只影响落盘，不该让「类型」跟着变。
   * 站方口径只分 video / normal 两档，图文贴夹视频在它那儿永远是 normal，
   * 结果「类型: 图文」的正文里躺着一段 mp4，看着别扭。 */
  function kindOf(o) {
    const counts = o.counts || {};
    const images = Number(counts.images) || 0;
    const videos = Number(counts.videos) || 0;
    if (images && videos) return "图文+视频";
    if (videos) return "视频";
    if (images) return "图文";
    return o.type === "video" ? "视频" : "图文";
  }

  function frontmatter(o) {
    o = o || {};
    const nick = String(o.nick || "");
    const tags = (o.tags || []).map((t) => String(t || "").trim()).filter(Boolean);
    const source = String(o.source || "小红书");
    const url = String(o.url || `https://www.xiaohongshu.com/explore/${o.noteId || ""}`);
    const lines = [
      "---",
      `来源: ${source}`,
      `作者: ${nick}`,
      `时间: ${dateParts(o.timeMs).time}`,
      `类型: ${kindOf(o)}`,
      `链接: ${url}`,
    ];
    if (tags.length) {
      lines.push("tags:");
      for (const t of tags) lines.push(`  - ${JSON.stringify(t)}`);
    }
    lines.push("---");
    return lines.join("\n");
  }

  function markdown(o) {
    o = o || {};
    const title = String(o.title || "");
    const lines = [frontmatter(o), `# ${title}`, ""];
    let body = String(o.desc || "").replace(/\[话题\]/g, "").replace(/［话题］/g, "");
    body = body.replace(/\n{3,}/g, "\n\n").trim();
    if (body) lines.push(body, "");
    if (o.comments && o.comments.length) {
      const comments = commentLines(o.comments);
      if (comments.length) lines.push("## 评论", "", ...comments, "");
    }
    const media = [...new Set((o.media || []).filter(Boolean))];
    media.forEach((item, i) => {
      const raw = typeof item === "string" ? item : String((item && item.path) || "");
      if (!raw) return;
      const path = raw.replace(/^\.\//, "");
      lines.push(`![${i + 1}](${rel(path)})`);
    });
    if (media.length) lines.push("");
    return lines.join("\n");
  }

  /* 默认档：短边 ≤ cap 的最高一档。
   * 竖屏的 1080P 就是 1080×1920，所以按短边判；按高判会把 1080×1920 一起踢掉，只剩 720P。
   * 全是大档（没有 ≤cap 的）退最小那档；尺寸未知的不参与判断，整表都未知就退回第一档。 */
  function pickDefaultQuality(list, cap = 1080) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return -1;
    const sized = (it) => it && it.width > 0 && it.height > 0;
    if (!arr.some(sized)) return 0;
    const i = arr.findIndex((it) => sized(it) && Math.min(it.width, it.height) <= cap);
    return i >= 0 ? i : arr.length - 1;
  }

  /* 评论区在 md 里的样子：三个站抓法各不相同，落到文件上应该长得一样。
   * 一条一级评论一个有序列表项，正文缩进；引用楼层用 > ；二级回复用二级列表项。 */
  function commentsMarkdown(comments) {
    if (!comments || !comments.length) return "";
    const clean = (text) => String(text || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    const lines = ["## 评论", ""];
    comments.forEach((comment, index) => {
      lines.push(`${index + 1}. **${comment.author || "匿名"}**${comment.time ? ` · ${comment.time}` : ""}`);
      const quote = clean(comment.quote);
      if (quote) lines.push("", `   > ${quote.replace(/\n/g, "\n   > ")}`);
      const text = clean(comment.text);
      if (text) lines.push("", `   ${text.replace(/\n/g, "\n   ")}`);
      for (const reply of comment.replies || []) {
        const rt = clean(reply.text);
        if (!rt) continue;
        lines.push(
          "",
          `   - **${reply.author || "匿名"}**${reply.time ? ` · ${reply.time}` : ""}：${rt.replace(/\n/g, " ")}`
        );
      }
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  globalThis.__RN = { name, dateParts, base, dir, rel, kindOf, markdown, frontmatter, videoOptions, pickDefaultQuality, commentsMarkdown };
})();
