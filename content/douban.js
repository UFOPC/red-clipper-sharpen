/* 豆瓣（影评 / 书评 / 乐评 / 小组话题）适配
 *
 * 结构要点（影评，2026-11 实测 movie.douban.com/review/17890635）：
 *   路径   /review/<id>/，movie / book / music / www 四个子域同一套模板
 *   标题   #content h1 > span
 *   作者   .main-hd a[href*="/people/"]
 *   时间   .main-meta span[content]：content 属性是 yyyy-mm-dd，文本里还带着时分秒
 *   对象   .main-hd a[href*="/subject/"]（评的是哪部电影/哪本书），拿去当 tag
 *   正文   .review-content，子节点是 <p> 与 <div class="image-container">
 *   图片   .image-container img，src 直给（没有懒加载属性），落在 img*.doubanio.com
 *
 * 小组话题（/group/topic/<id>/）与影评不同，且**这套结构没能在真实页面上核对**：
 * 小组/社区侧对自动化访问单独下了拦截（2026-11 复测：www 回 403「没有访问权限」，
 * m.douban.com 回 404；同一时刻 movie.douban.com/review/ 仍能正常打开，
 * 所以是小组侧拦的，不是全站）。因此下面每个字段都是多候选兜底，
 * 一处猜一个 class 写死的写法一律不用：
 *   标题   #content h1 → .topic-doc h1 → h1
 *   正文   .topic-richtext → .rich-content.topic-richtext → .topic-content .rich-content
 *          → #link-report .topic-content → .topic-content
 *   作者   只认 href 含 /people/ 的锚点（h3 里同时有组名，整段取会把组名当作者）
 *   时间   .create-time 之类的纯文本，靠 parseDateText 解析
 *   回复   .comment-item 在正文容器之外，walkBody 只走容器子树，天然不带进 md
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
  /* 豆瓣话题有两种地址：老的小组内 /group/topic/<id>/，新的顶层 /topic/<id>/。
   * 页面模板是同一套，所以共用 readTopic()，只在这里放宽路径。 */
  const TOPIC_RE = /^\/(?:group\/)?topic\/(\d+)\/?$/;
  const SKIP_IMG = /\/(icon|avatar|upfallback)\//i;
  const UA_REFERER = "https://www.douban.com/";

  let media = true;

  /* ---------- 取数 ---------- */

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* 候选选择器按序试，命中第一个就用，全不中返回 null。
   * 小组话题的类名没能对着真实页面核过，所以每条字段都给几个候选；
   * 是否「留空」还是「算失败」由调用方定，这里不做猜测性兜底。 */
  function pick(list, root) {
    const scope = root || document;
    for (const sel of list) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /* 取「第一个真的有文字」的节点。与 pick 的区别是**跳过空节点**：
   * 豆瓣动态页的 <h1 class="topic-title"></h1> 存在但一个字符都没有，
   * querySelector 命中它就等于整页判成无标题/无作者，而界面上胶囊照旧挂着。 */
  function firstText(list, root) {
    const scope = root || document;
    for (const sel of list) {
      for (const el of scope.querySelectorAll(sel)) {
        if (squash(el.textContent)) return el;
      }
    }
    return null;
  }

  /* 小组话题的时间是纯文本（「2024-11-05 21:33:07 来自网页」），没有影评那种
   * span[content] 属性，所以单独解析，不复用 parseTime()——那个把
   * .main-meta span[content] 写死在里面了。
   * 解析不出回落 Date.now()：frontmatter 总要有日期，缺了文件名与排序都会别扭。 */
  function parseDateText(text) {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(squash(text));
    if (m) {
      const date = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      if (Number.isFinite(date.getTime())) return date.getTime();
    }
    return Date.now();
  }

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

  /* 个人动态页（/topic/<id>/）的相册**不在 DOM 里**：整组图塞在
   *   window._CONFIG.topic = { id: "…", photos: [ {image:{large:{url:…}}} ] }
   * 再由页面 JS 渲染进 #horizontal-root。内容脚本跑在隔离世界，读不到页面的 window；
   * 而这段赋值语句就在 <script> 的文本里，直接读文本即可。
   *
   * 两个限制决定了写法：
   *   1. 外层对象是**非严格 JSON**（`{ id: "…" }` 键没加引号），不能整段 JSON.parse；
   *   2. MV3 内容脚本里 eval / new Function 被 CSP 挡死，也不能当 JS 求值。
   * 所以只对 photos 那个数组做括号平衡扫描 + JSON.parse（数组本身是标准 JSON），
   * 解析失败再用正则捞 "large":{"url"} 兜底。
   *
   * 之所以不走后台 MAIN world 注入：那需要 host_permissions 加 *.douban.com，
   * 而这里要读的只是一段静态文本，不值得为此扩权限。 */
  function albumPhotos() {
    const urls = [];
    const push = (raw) => {
      const url = String(raw || "").replace(/\\\//g, "/");
      if (!/^https?:\/\//i.test(url) || SKIP_IMG.test(url) || urls.includes(url)) return;
      urls.push(url);
    };

    for (const el of document.querySelectorAll("script:not([src])")) {
      const text = el.textContent || "";
      if (text.indexOf("_CONFIG.topic") < 0) continue;
      const at = text.indexOf("photos");
      const open = at < 0 ? -1 : text.indexOf("[", at);
      if (open < 0) continue;

      /* 平衡扫描要跳过字符串里的 [] 与转义，否则 url 里的括号会把深度带偏。 */
      let depth = 0;
      let inStr = false;
      let esc = false;
      let close = -1;
      for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "[") depth++;
        else if (c === "]") {
          depth--;
          if (!depth) {
            close = i;
            break;
          }
        }
      }
      const slice = close > open ? text.slice(open, close + 1) : "";

      if (slice) {
        try {
          for (const item of JSON.parse(slice)) {
            const img = (item && item.image) || {};
            const large = img.large || img.normal || img;
            push(large && large.url);
          }
        } catch (e) {
          /* 形状变了：落到正则兜底，别整页放弃。 */
        }
      }
      if (!urls.length) {
        const re = /"large"\s*:\s*\{[^{}]*?"url"\s*:\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(slice || text))) push(m[1]);
      }
      if (urls.length) return urls;
    }

    /* 相册已经被渲染出来时（页面 JS 跑完），直接从 DOM 兜底取。 */
    for (const img of document.querySelectorAll("#horizontal-root img, .topic-content img")) {
      push(imageUrl(img));
    }
    return urls;
  }

  /* 胶囊是挂进 h1 的子节点，直接读 h1.textContent 会把面板文案
   * 「剪藏 / 图片 / N 张 / 下载 / 跳过 / 保存」一起读进标题——标题会进目录名和
   * md 文件名，污染是永久的。所以取标题时克隆一份、把 slot 摘掉再读。
   * slot 还没建（首次 tick 之前）时 el 不含它，直接读即可。 */
  function titleText(el) {
    if (!el) return "";
    if (!slot || !el.contains(slot)) return squash(el.textContent);
    const clone = el.cloneNode(true);
    const junk = clone.querySelector(".db-xhx-slot");
    if (junk && junk.parentElement) junk.parentElement.removeChild(junk);
    return squash(clone.textContent);
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
      titleText(document.querySelector("#content h1"));
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

  /* 豆瓣小组话题（/group/topic/<id>/）。返回结构与 readReview() 对齐，
   * 多一个 incomplete 标记，让 UI 能把「结构没认出来」显示出来而不是静默失败。
   *
   * 两处与影评的关键差别：
   *   作者  h3 里同时挂着小组名和作者名，只能认 href 含 /people/ 的那个锚点；
   *         取不到就留空字符串——空的 nick 走 layout() 的兜底是安全的，
   *         而拿组名冒充作者会写进文件名和 frontmatter，比空着糟得多。
   *   正文  取不到容器时**不返回 null**：返回 null 会让点击后什么都不发生，
   *         用户以为按钮坏了。这里置 incomplete，由 act 回调显示「未识别」。 */
  function readTopic() {
    const m = TOPIC_RE.exec(location.pathname);
    if (!m) return null;

    /* 标题：找第一个**真的有字**的节点。豆瓣动态页里 `<h1 class="topic-title"></h1>`
     * 是个空壳（2026-11 实测 /topic/502558660/），querySelector 命中它就等于把整页
     * 判成「没有标题」——胶囊照样挂上去了，点下去只会显示「未识别」。 */
    const title = titleText(firstText([".topic-title", "#content h1", ".topic-doc h1", "h1"]));

    /* 候选按「越像正文越靠前」排，命中即止。最后那条 .topic-content 是纯兜底：
     * querySelector 取文档序第一个，而话题正文排在回复列表之前，正常版面下命中的是正文；
     * 但若站方给回复区也用了同名类，这一条有可能抓成某条回复——incomplete 拦不住这种
     * （抓到的是非空文本），所以它只是兜底，不是等价候选。 */
    const root = pick([
      ".topic-richtext",
      ".rich-content.topic-richtext",
      ".topic-content .rich-content",
      "#link-report .topic-content",
      ".topic-content",
    ]);
    const { text, images } = root ? walkBody(root) : { text: "", images: [] };
    /* 正文容器里一张图都没有时，去相册里取（动态页的图全在 _CONFIG / #horizontal-root）。
     * 小组话题这类正文自带 <img> 的页面 images 非空，完全不受影响。 */
    if (!images.length) images.push(...albumPhotos());

    /* 两种页面的作者位置不同：
     *   小组话题  .topic-doc h3 里同时有组名与作者，只能认 href 含 /people/ 的那个
     *   个人动态  .article-meta 里的 a.author-name（.user-face 那个只有头像，没有文字） */
    const nick = squash(
      (firstText([
        ".article-meta .author-name",
        ".topic-doc h3 a[href*='/people/']",
        ".article-meta a[href*='/people/']",
        ".user-face a[href*='/people/']",
        ".topic-doc .from a[href*='/people/']",
        ".topic-doc a[href*='/people/']",
      ]) || {}).textContent
    );

    /* 小组名当 tag；个人动态没有组名，退到 .gallery 里的话题名（实测「我的旅行日记」）。 */
    const subject = squash(
      (firstText([
        ".topic-doc h3 a[href*='/group/']",
        ".topic-doc h3 .color-green",
        ".gallery a",
      ]) || {}).textContent
    );

    const timeEl = firstText([
      ".topic-meta .create-time",
      ".create-time",
      ".topic-time",
      ".topic-doc .create-time",
    ]);

    /* 动态页确实没有标题，不能因此判成「不是正文页」：
     * 用正文首句前 24 字（与微博单条同一口径），再兜底 <作者>_动态_<id>。
     * 只有标题与正文**都**取不到，才算这页不是正文（列表页 / 登录墙 / 风控页）。 */
    const derived = title || squash(text.split("\n")[0]).replace(/[#＃]/g, "").slice(0, 24);
    /* 标题与正文都取不到，才是真不是正文页（列表页 / 登录墙 / 风控页），不注入。 */
    if (!derived) return null;

    return {
      id: m[1],
      title: derived || `${nick || "豆瓣"}_动态_${m[1]}`,
      nick,
      subject,
      time: parseDateText((timeEl || {}).textContent),
      body: text,
      images,
      /* 链接按用户实际打开的那条写：/topic/ 与 /group/topic/ 是两种形态，
       * 写死其中一种会让 frontmatter 里的地址点开 404 或跳错页。 */
      url: location.origin + location.pathname,
      /* 正文抓空 = 候选选择器全没命中。标记出去，让保存路径在写盘前拦住。 */
      incomplete: !text,
    };
  }

  /* 同一个 content script 管两种模板，入口统一从这里分流。 */
  function readInfo() {
    if (REVIEW_RE.test(location.pathname)) return readReview();
    if (TOPIC_RE.test(location.pathname)) return readTopic();
    return null;
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
    const failedFetch = [];
    const failedWrite = [];
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
            /* 取不到字节就不要写死引用：doubanio 的裸地址必回 418，
             * 写进 md 只会得到一条指向不存在文件的链接（破坏「引用数==落盘数」）。
             * 该张既不占 names[j]，也不进 batch，最后由 md 末尾一行统一交代。 */
            failedFetch.push({ no: j + 1, error: (e && e.message) || String(e) });
            continue;
          }
          names[j] = RN.mediaPath(layout.mediaStem, j + 1, ext);
          batch.push({ filename: layout.prefix + names[j], url });
        }
        const res = await chrome.runtime.sendMessage({ type: "downloadFiles", data: { files: batch } });
        /* 落盘失败与取字节失败是两回事：前者字节可能已拿到，得单独记、单独写一行。 */
        if (res && res.failed) failedWrite.push(...res.failed);
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
    if (failedFetch.length) {
      body += "\n\n> " + RN.fetchFailNote(failedFetch) + "，未写入引用。";
    }
    if (failedWrite.length) {
      body += "\n\n> 另有 " + failedWrite.length + " 个文件下载失败：" + RN.writeFailNote(failedWrite) + "。";
    }

    /* 相册图**不在正文里**：动态页的正文只有一段文字，17 张图全挂在
     * window._CONFIG.topic.photos 上（由页面 JS 渲染成相册）。
     * 这些字节照样落盘了，但正文里没有任何占位符可替换——不补这一节，
     * md 里就一处引用都没有，用户会得到 17 个不知道属于哪篇的孤儿文件。
     * 只补「没被正文引用过」的那些，图文模板（影评/小组话题）不受影响。 */
    const used = new Set([...info.body.matchAll(/\u0000(\d+)\u0000/g)].map((m) => Number(m[1])));
    const orphans = names.map((name, i) => (name && !used.has(i) ? i : -1)).filter((i) => i >= 0);
    if (orphans.length) {
      body += "\n\n## 图片\n";
      for (const i of orphans) body += "\n![" + (i + 1) + "](" + RN.rel(names[i]) + ")";
      body += "\n";
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

    const mdRes = await chrome.runtime.sendMessage({
      type: "downloadFiles",
      data: { files: [{ filename: layout.md, text: md, mime: "text/markdown" }] },
    });
    /* md 自己没落盘时不能写进 md（它根本没落盘，注记等于自欺），只能回传给 UI。
     * 用 filename 精确比对，别用 failed.length——那一批只有 md 一个文件，但口径要一致。 */
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
    const info = readInfo();
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
    entry.title = "小红虾 · 保存这篇内容";
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
      /* 第一条语句就得可见：先把文案从「保存」挪走，再说认不认得出正文。
       * 曾经是 `const info = readInfo(); if (!info) return;`——读不出来、或者
       * readInfo 本身抛异常（未捕获的 rejection），界面上都是「点了完全没反应」，
       * 分不清是没点到、没认出、还是坏了。现在「…」证明点击生效过，
       * 之后必然停在「未识别 / 失败 / N/M」三者之一。 */
      if (act.disabled) return;
      const label = act.textContent;
      const withMedia = media;
      /* md 未落盘时文案要停留久一点，900ms 眨眼就没；成功路径仍是 900ms，逐字不变。 */
      let hold = 900;
      act.disabled = true;
      act.textContent = "…";
      /* 扩展重新加载过、页面没刷，内容脚本的上下文已经失效：之后每个 sendMessage 都会抛
       * Extension context invalidated。这种不是「失败」，用户该做的是刷新页面，
       * 所以在下面 catch 里按错误文本分类成「请刷新」。 */
      try {
        /* 正文没认出来就别往下走：deliver() 会写一份只有 frontmatter 的空 md，
         * 那等于把「没抓到」伪装成「保存成功」。放在 try 里是为了复用下面那条
         * finally 还原路径（还原文案 + 解除 disabled + 收面板），不另起一套定时器。
         * 位置在任何 downloadFiles 之前，一个字节都不会发出去。 */
        const info = readInfo();
        if (!info || info.incomplete) {
          act.textContent = "未识别";
          hold = 4000;
          /* 控制台留一份可核对的现场：标题有没有、正文容器有没有，这两条决定该补哪个选择器。 */
          console.warn("[小红虾] 豆瓣没认出这篇", {
            path: location.pathname,
            title: !!(info && info.title),
            body: !!(info && !info.incomplete),
          });
          return;
        }
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
        /* 上下文失效不是这篇抓不动，重试多少次都一样；说清该刷新比说「失败」有用。
         * 判据用真实异常文本，不预先探 chrome.runtime.id——离线用例里的 chrome 是 mock，
         * 没有 id 字段，按属性探会把「用例环境」误判成「上下文失效」。 */
        const stale = /Extension context invalidated|message port closed|Receiving end does not exist/i.test(msg);
        act.textContent = stale ? "请刷新" : "失败";
        /* 失败文案也要能看清：900ms 一闪而过，等于又变回「没反应」。 */
        hold = 4000;
        console.error("[小红虾] 豆瓣保存失败", e);
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

  /* 挂到标题行：豆瓣 h1 只有一行标题，胶囊跟在标题后面最不打眼。
   * 但 h1 必须是**有字**的那个——动态页的 .topic-title 是空壳，
   * 挂进空 h1 时胶囊会悬在标题空白处，和下面的作者/正文完全脱节。
   * 空标题时退到作者行（.article-meta），再退到内容块开头。 */
  function findAnchor() {
    const h1 = firstText(["#content h1", ".topic-doc h1", "h1"]);
    if (h1) return h1;
    return pick([".article-meta", "#topic-content", ".personal-topic", ".main-hd"]);
  }

  function tick() {
    /* 影评与小组话题共用这一套 UI；都不命中（小组首页 / 列表页等）才摘掉胶囊。 */
    if (!REVIEW_RE.test(location.pathname) && !TOPIC_RE.test(location.pathname)) {
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
