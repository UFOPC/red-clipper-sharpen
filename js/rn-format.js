/* Rednote-Sharpen 命名与 Markdown 规范（供 background service worker 与 content scripts 共用）
 * 目录：<标题>/，无标题时使用 未命名文件_<作者>_<发布日期>/；标题中的空白与括号不进目录名或文件名。
 * 文件：MD <YYYY.MM.DD_标题_作者>.md；评论 <YYYY.MM.DD_标题>-comments.json。
 * 媒体：images|media/<YYYY.MM.DD_标题>-NN.ext；评论图 comments/<YYYY.MM.DD_标题>-NN-cN.ext。
 * MD：frontmatter(来源/作者/时间/类型/链接/tags) + # 标题 + 正文 + ![N](./N.ext)；视频同用图片语法，Obsidian 按扩展名渲染成可播放的播放器
 */
(() => {
  /* 字符集按 chrome.downloads.download 的 filename 校验规则来（非法直接 reject，报 Invalid filename）：
   *   Cc 控制符、Cf 格式符（LRM/RLM/软连字符/word joiner/ZWJ/BOM…）、Cn 非字符
   *   ~ 与 : " ? * | 同属被拒字符
   * 以前只挡 \x00-\x1F\x7F，LRM/软连字符这类标题里真会混进来的字符会原样落到文件名上，
   * 结果是整篇 md 一个字节都不落。 */
  const CONTROL = /[\p{Cc}\p{Cf}\p{Cn}]/gu;
  const ZERO = /[\u200B-\u200D\uFEFF]/g;
  const RESERVED = /[/\\|<>"?*~]/g;
  const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu;
  const MODIFIER = /\p{Emoji_Modifier}/gu;
  /* NTFS 保留设备名：CON / PRN / AUX / NUL / COM1-9 / LPT1-9，带不带扩展名都非法。
   * 不整体替换（那会把标题改得面目全非），加下划线前缀让它变成普通名字。 */
  const DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/i;

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
    /* 放在最后：上面那行会把前导下划线剥掉，先加前缀就白加了。 */
    return text.replace(DEVICE, "_$1");
  }

  /* 长度闸门只在「拼路径」这一层做，不进 name()——name() 不知道自己会被拼进目录名还是
   * 文件名、后面还要不要接日期与后缀，在那里截多短都可能是错的。
   * 判据与切片都按码点走：含代理对（emoji 之外的生僻字也是）时 text.length 会多算一倍，
   * 拿它当判据会在「码点没超」的情况下白跑一遍切片。先看码元数不超就直接返回，省掉展开。 */
  const MAX_TITLE = 60;
  const MAX_NICK = 24;
  const clamp = (text, max) => {
    if (text.length <= max) return text;
    const chars = [...text];
    return chars.length > max ? chars.slice(0, max).join("") : text;
  };

  // 标题里的空白与括号只制造路径噪音；作者名仍按 name() 的通用规则处理。
  const TITLE_NOISE = /[\s()（）\[\]【】{}｛｝]/g;
  const titleName = (value) => clamp(name(value).replace(TITLE_NOISE, ""), MAX_TITLE);
  const nickName = (value) => clamp(name(value), MAX_NICK);
  const pad = (n) => (n < 10 ? "0" + n : String(n));

  function dateParts(ms) {
    const value = Number(ms);
    const d = new Date(Number.isFinite(value) && value > 0 ? value : Date.now());
    const date = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return { date, time };
  }

  function base(title, nick, ms) {
    return [dateParts(ms).date, titleName(title), nickName(nick)].filter(Boolean).join("_");
  }

  function assetBase(title, ms) {
    return [dateParts(ms).date, titleName(title)].filter(Boolean).join("_");
  }

  function dir(title, nick, ms) {
    const clean = titleName(title);
    if (clean) return clean;
    return "未命名文件_" + (nickName(nick) || "未知作者") + "_" + dateParts(ms).date;
  }

  /* 四站共用同一组路径，不再各自拼作者目录或媒体文件名。
   * MD 主干含作者；其余产物一律使用不带作者的 mediaStem。 */
  function layout(title, nick, ms) {
    const named = !!(titleName(title) || nickName(nick));
    const stem = named ? base(title, nick, ms) : "未命名文件";
    const mediaStem = named ? assetBase(title, ms) : "未命名文件";
    const directory = dir(title, nick, ms);
    const prefix = directory ? directory + "/" : "";
    return {
      prefix,
      stem,
      mediaStem,
      md: prefix + stem + ".md",
      comments: prefix + mediaStem + "-comments.json",
    };
  }

  function mediaPath(stem, index, extension, video = false) {
    return (video ? "media/" : "images/") + stem + "-" + pad(index) + extension;
  }

  function commentPath(stem, root, index, extension) {
    return "comments/" + stem + "-" + pad(root) + "-c" + index + extension;
  }

  /* md 里的相对路径必须写成合法 URI，否则渲染器不认。
   * 标题中的空白与括号已在 titleName() 去掉，但作者名等其余片段仍可能带这些字符；
   * CommonMark 的链接目标遇到空格会截断，括号也可能拆坏目标，所以这里仍统一转义。
   * 中文和全角标点保持可读。 */
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

  /* ---------------- 失败注记 ----------------
   * 六站共用同一套措辞，别让每个适配器各写一套。
   * 两类失败的处置方式不同，注记必须分开写：
   *   取字节失败（fetchMedia / 页面 fetch）→ 图根本没拿到，用户该「重存一次」
   *   落盘失败（chrome.downloads 抛错）   → 字节可能已经拿到，用户该看错误码
   * error 串一律原样展示、不做映射：映射表会在后台与适配层各留一份真相，迟早漂。 */

  /* 取字节失败，同一句 error 不重复 N 遍：
   *   "第 3、7 张图取不到字节（timeout）；第 9 张（HTTP 403）" */
  function fetchFailNote(list) {
    const groups = new Map();
    for (const item of list || []) {
      const why = String((item && item.error) || "").trim() || "未知原因";
      if (!groups.has(why)) groups.set(why, []);
      groups.get(why).push(Number(item && item.no) || 0);
    }
    const parts = [];
    for (const [why, nos] of groups) {
      const label = `第 ${nos.join("、")} 张`;
      parts.push(`${label}${parts.length ? "" : "图取不到字节"}（${why}）`);
    }
    return parts.join("；");
  }

  /* 落盘失败，只留「标题/文件名」两段（整条 <标题>/images/... 太长），
   * 最多列 limit 条，其余折成「等 N 个」（N 是总数）：
   *   "images/…-03.jpg（NETWORK_FAILED）、images/…-05.jpg（Invalid filename）等 8 个" */
  function writeFailNote(list, limit = 5) {
    const items = list || [];
    const shown = items.slice(0, limit).map((item) => {
      const tail = String((item && item.filename) || "").split("/").slice(-2).join("/");
      const why = String((item && item.error) || "").trim();
      return why ? `${tail}（${why}）` : tail;
    });
    const out = shown.join("、");
    return items.length > shown.length ? `${out}等 ${items.length} 个` : out;
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

  globalThis.__RN = { name, dateParts, base, assetBase, dir, layout, mediaPath, commentPath, rel, kindOf, markdown, frontmatter, videoOptions, pickDefaultQuality, commentsMarkdown, fetchFailNote, writeFailNote };
})();
