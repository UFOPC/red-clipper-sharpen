# Xiao Hong Xia · Download Assistant

> A Chrome / Edge extension (Manifest V3) that saves Xiaohongshu notes, Discuz forum threads (Chiphell, PCbeta,
> Enshan, Erji), Douban reviews and group topics, SSPAI articles, SMZDM articles, WeChat public-account posts,
> single Weibo posts, and Xiachufang recipes — together with their images, videos, and comments — as a Markdown
> file with YAML frontmatter plus media organized into dedicated folders.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[中文](./README.md) · **English**

> **Note:** the extension UI is Chinese-only, and every supported site is a Chinese-language platform.
> This English README is provided for reference and for readers who prefer English documentation.

---

## What problem does it solve?

There is no shortage of tools that turn web pages into Markdown. But at the "mixed text + original images + comments" stage, nearly all of them leave manual cleanup work:
image order is lost, comments have nowhere to go, filenames are full of illegal characters, and relative paths in the `.md` render as dead links.

This extension does exactly one thing: **click once on the page, and get a folder you can drop straight into your note vault.**

| | |
|---|---|
| Body | Preserves heading levels, paragraphs, quotes, and lists; strips the site's decorative elements (share bars, recommendations, edit buttons) |
| Images | Saved in body order; extensions are inferred from the **real MIME type**, not guessed from the URL suffix |
| Video | Xiaohongshu videos are selectable by quality tier; SMZDM in-page videos are saved after decrypting their hotlink protection |
| Comments | Optional "Body + Comments"; floor number, IP location, like count, and reply-to target are all preserved |
| Naming | `<title>/YYYY.MM.DD_<title>_<author>.md`; whitespace and brackets from titles stay out of paths, the author remains only in the Markdown filename, and untitled posts go into `未命名文件_<author>_<date>/` to separate different authors and publication dates |

## Supported sites

| Site | Domain | Content | Notes |
|---|---|---|---|
| Xiaohongshu | `xiaohongshu.com` | Image-text notes, video notes (quality selectable), Live Photos, original video, comments | Offers "Body", "Body + Comments", and "Images: Download / Skip" |
| Chiphell | `chiphell.com` | Thread body and all images | Supports "OP only" (`authorid`) and cross-page threads |
| PCbeta | `bbs.pcbeta.com` | Thread body and all images | Same Discuz engine as Chiphell — no extra JS |
| Enshan | `right.com.cn` | Thread body and all images | Same engine as above; the site runs slider captcha, so scripted runs hit a challenge |
| Erji | `erji.net` | Thread body, images, replies | Threads are not statically cached; served via `forum.php?mod=viewthread` |
| Douban | `douban.com` | Long-form movie / book / music reviews, group topics, personal timelines, with images | Reviews and timelines are verified; group pages answer 403 to automated requests, so their class names are matched through a candidate list — when the body cannot be found the button reports "unrecognised" and nothing is written. Images live on `doubanio.com` and return 418 to bare requests; the worker attaches a Referer and fetches the bytes. On timelines `h1.topic-title` is an empty shell, so the title falls back to the first 24 characters of the body; the album images are not in the DOM at all (they hang off `window._CONFIG.topic.photos` and are rendered by page JS), so they are read from the inline config instead, and a trailing "## 图片" section lists every image the body never referenced — the reference count always equals the number of files written |
| SSPAI | `sspai.com` | Article body, images, comments | Direct image requests return 403; bytes are fetched by the content script |
| SMZDM | `post.smzdm.com` | Article body, images, in-page video, comments | Only `/p/` article pages; image `.jpg` suffixes are unreliable, MIME must be restored |
| WeChat public accounts | `mp.weixin.qq.com` | Article body and images | The self-use build can switch its output layout to match Wechat-Sharpen; the release build always uses the generic tree |
| Weibo | `m.weibo.cn` | Single image-text or gallery post, upgraded to `/large/` originals | Only `/status/<id>` and `/detail/<id>`; video posters do not count as images, and videos are not downloaded |
| Xiachufang | `xiachufang.com` | Recipe intro, ingredient table, step images, finished-dish images | Strips the `?imageView2/…` thumbnail instruction to get the original; the CDN answers bare requests with 200, no Referer needed |

> The desktop Weibo adapter (`weibo.com/detail/<mid>`) is wired into the manifest, but its API fields are built
> entirely from the public endpoints and **have never been checked under a logged-in session**, so it is left
> out of the table for now.

## Installation

**From a Release**

1. Download the latest `XHX-<version>.zip` (XHX is short for Xiao Hong Xia) and extract it to a permanent folder (not the Desktop — it disappears when the Desktop is cleaned). Running `node build.mjs` also produces a self-use build (`XHX-self-<version>.zip`) that is **not attached to releases**: identical, except that WeChat public-account posts default to the Wechat-Sharpen layout and the options page keeps a layout switch for them
2. Open `chrome://extensions` (or `edge://extensions` on Edge)
3. Turn on "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extracted folder
5. Open any supported site — a red capsule appears on the page

**From source:** same as above, but select the repository root in step 4 — the repository *is* the unpacked extension directory, with no build step.

> Upgrading: replace the files in the folder, then click the refresh button for that extension on the extensions page.

## Usage

| Action | Result |
|---|---|
| Hover the capsule | Opens the options panel |
| Click the capsule | Saves with the current options (image-text note = body + images; video note = body + selected quality) |
| Panel "Body" | Saves body and media only, without comments |
| Panel "Body + Comments" | Body + comment section (including one level of nested replies) |
| Panel "Images: Download / Skip" | If skipped, only the `.md` is written; no media is fetched |
| Panel "Video quality" | Quality tiers with per-tier size; defaults to the highest tier whose shorter side is ≤ 1080p |
| Click the capsule while downloading | Cancels the download |

**Batch download is intentionally not offered.** Batching would mean opening dozens of detail pages and requesting write access to disk; it is unfriendly to the sites and easily gets accounts flagged by risk control.

## Output layout

```
S101CanyonWeekend/
├── 2026.08.03_S101CanyonWeekend_Jane Doe.md
├── 2026.08.03_S101CanyonWeekend-comments.json
├── images/
│   ├── 2026.08.03_S101CanyonWeekend-01.png
│   └── 2026.08.03_S101CanyonWeekend-02.jpg
├── media/
│   └── 2026.08.03_S101CanyonWeekend-01.mp4
└── comments/
    ├── 2026.08.03_S101CanyonWeekend-01-c1.png
    └── 2026.08.03_S101CanyonWeekend-01-c2.png
```

All sites use this layout. WeChat public-account posts are the one exception: the self-use build can switch them
to a Wechat-Sharpen-compatible tree on the options page. In the `comments/` examples, `01` identifies the owning top-level comment and is inherited by nested replies; `cN` is a global comment-image counter for the whole post and never resets within an individual comment.

```yaml
---
来源: 小红书
作者: 张三
时间: 2026-08-03_14:22:31
类型: 图文+视频
链接: https://www.xiaohongshu.com/explore/xxxx
---
```

The frontmatter keys (`来源` source / `作者` author / `时间` time / `类型` type / `链接` link / `tags`) and the `类型` values are intentionally Chinese — the output targets Chinese note vaults.

`类型` (type) is derived from what the note actually contains: images and video → `图文+视频`; video only → `视频`; images only or no media → `图文`.
It describes **the note itself** and does not change with save options like "Skip" — otherwise saving the same post twice would yield two different types.

### Two invariants

1. **Body reference count == body-media file count across `images/` + `media/` == the count shown on the panel.** Any mismatch is a bug.
   Comment images under `comments/` are excluded from this equation; they have their own references immediately after the corresponding comment text. Each referenced video produces one primary file, so alternative quality tiers or original-video copies do not distort the count.
2. **Relative paths in the `.md` must be valid URIs.** Whitespace and brackets are removed from title-derived path segments, but other fragments such as author names may still contain them.
   CommonMark link destinations can be truncated or broken by those characters, so references into `images/`, `media/`, and `comments/` are still URI-escaped.
   (`encodeURIComponent` cannot be used: it leaves `( ) ' ! *` untouched, and a parenthesis in the path breaks the link just the same.)

## Site-specific gotchas (field notes)

**SSPAI's hotlink protection.** Requests issued by `chrome.downloads.download` carry no Referer, and `declarativeNetRequest`'s
`modifyHeaders` has no effect on download requests — those are sent directly by the browser process, outside any path an extension can rewrite. The fix: the content script first
`fetch`es the image (with the page origin, 200) → blob → `data:` URL → hands that to the downloader.

**SMZDM's fake suffixes.** The trailing `.jpg` in `xxx.png_e1080.jpg` is a server-side instruction; the actual response is `image/png`:

| URL | Status | Real type | Size |
|---|---|---|---|
| `xxx.png_e1080.jpg` | 200 | `image/png` | 697 KB |
| `xxx.png_fo710.jpg` | 200 | `image/png` | 284 KB |
| `xxx.png` (bare) | 403 | — | — |

The extension name is therefore inferred from **the segment before the instruction**; no extra probe request is sent, and the md references cannot drift from what lands on disk when the downloader renames by MIME.
Video URLs are signed (`?t=…&sign=…`) and **must not** be rewritten to another tier — any modification invalidates them.

**Chiphell's author mode.** Entering "OP only" via the `authorid` parameter changes how floor ownership is determined; entering from page 2 requires going back to page 1 to read the metadata (folder name, author, time), or you get a replier instead of the OP.

**Chiphell's attachment grid.** Images the author uploaded but never inserted into the body are laid out at the bottom of the post inside `div.pattl > ignore_js_op > dl.tattl > div.savephotop` — **outside `td.t_f`**. Scanning only `td.t_f` drops them all (measured on tid=2915041: 7 inline + 29 in the grid = 36). `postImages()` / `postBody()` now merge "`td.t_f` + the same post's grid" and dedupe by URL.

**SMZDM's comment authors.** `.display-nickname` appears 40 times on the page and all of them are **comment** authors; the body author exists only in `meta[property="article:author"]`.

## Add a Discuz site

Discuz! X3 thread pages are consistent enough that the four Discuz sites (Chiphell, PCbeta, Enshan, Erji) share a single engine, `content/discuz.js`: body `td.t_f[id^="postmessage_"]`, author `.authi .xw1`, posted time `em[id^="authorposton"]`, attachment grid `.pattl / .tattl`, quotes `.quote`, pagination `.pg a`, breadcrumb `#pt`.

Adding a site takes two edits and **no new content script**:

1. Add an entry to the `SITES` table at the top of `content/discuz.js` — a `host` regex, a `source` label, `parse()` (URL → tid / page / authorId) and `pageUrl()` (the pagination URL).
2. Add the domain to **both** `content_scripts.matches` and `web_accessible_resources[].matches` in `manifest.json`.

Those two lists do not follow the same rules, and confusing them breaks the whole extension:

| | `content_scripts.matches` | `web_accessible_resources[].matches` |
|---|---|---|
| Path patterns | allowed | **rejected** — origin-level `*://<host>/*` only |
| Real example | `*://m.weibo.cn/status/*`, `*://post.smzdm.com/p/*` | `*://m.weibo.cn/*`, `*://post.smzdm.com/*` |

Copying a path-level pattern into the second list makes Chrome refuse to load the extension with `Invalid value for 'web_accessible_resources[0]'. Invalid match pattern.` `build.mjs` validates both lists, so a bad pattern fails the build instead of the install.

Verify with the regression scripts:

```bash
# Old vs new engine must produce byte-identical output
PW=… PW_EXE=… node test/regress-discuz.mjs <old-dir> <new-dir> <thread-snapshot.html>

# New site on a real page: open → inject → click → assert body and frontmatter
PW=… PW_EXE=… node test/e2e-real-discuz.mjs https://bbs.pcbeta.com/viewthread-1079227-1-1.html
```

## WeChat: two layouts

WeChat articles can be written in either layout. The switch exists **only in the self-use build**: the release build strips that section from the settings page and always uses the native layout.

| | Native (release-fixed) | Self-use · aligned with Wechat-Sharpen |
|---|---|---|
| Folder | `<title>/` | `YYYY-MM/YY-MM-DD/` |
| File | `YYYY.MM.DD_<title>_<account>.md` | `<title>.md` |
| Images | `images/<…>-01.png` | `assets/<aid8>_<NNN>_<url8>.<ext>` |
| References | `![1](./images/…)` | `![image](assets/…)` |
| frontmatter | `来源 / 作者 / 时间 / 类型 / 链接` | `title / source / published / created` |

Native output matches every other site. The self-use layout reproduces the Wechat-Sharpen pipeline because an existing `09-Article` folder already holds dozens of its files — two naming schemes in one folder break a single Dataview query.

The switch writes `layout` into `chrome.storage.local`; the content script reads it once at page load, so **reload the article page** after flipping it.

## Project structure

```
manifest.json          MV3 manifest: nine content scripts (eleven sites) + one service worker
js/
  background.js        message routing, IndexedDB staging, Xiaohongshu fetching and assembly
  rn-format.js         naming / frontmatter / text-image layout / quality tiers, shared by all sites
  setting.js|css       options page (site list and version number)
content/
  index.js|css         Xiaohongshu: capsule, panel, comment expansion, progress, quality, original video
  discuz.js|css        Discuz! X engine (Chiphell / PCbeta / Enshan / Erji): author mode, paging, attachment grid
  douban.js|css        Douban: reviews, group topics and timelines, with Referer-guarded image bytes
  sspai.js|css         SSPAI: includes hotlink-protection handling
  smzdm.js|css         SMZDM: includes MIME restoration and video decryption
  wechat.js            WeChat public accounts: Wechat-Sharpen-compatible output layout
  weibo.js|css         Weibo: single post, images upgraded to `/large/`
  weibo-desktop.js     Weibo desktop: experimental, API not verified under a login
  xiachufang.js|css    Xiachufang: recipe parsing, thumbnail-instruction stripping
  format-size.js       size formatting (base 1000, no library)
setting.html           options page
test/                  Playwright end-to-end tests
```

### Background message protocol

Content scripts talk to the service worker via `chrome.runtime.sendMessage`:

| `type` | Payload | Purpose |
|---|---|---|
| `getNote` | `{downloadId}` | Enters the page's MAIN world to fetch the raw note object |
| `saveData` | `{downloadId, withComment, rnOnly, videoUrl, skipMedia}` | Assembles the file list and writes it to IndexedDB |
| `download` | `{downloadId}` | Downloads the listed files one by one |
| `downloadFiles` | `{data:{files:[…]}}` | Hands over a batch of files directly (used by the site adapters) |
| `downloadUrl` | `{data:{url, filename, md?, mdFilename?}}` | Downloads media first, then (optionally) writes the md |
| `fetchMedia` | `{data:{url}}` | Fetches image bytes in the worker (bypassing CORS), returns `{ok, type, base64}` |
| `clearData` / `cancel` | — | Clears staging / cancels the current save |

Staging uses IndexedDB rather than memory: MV3 service workers get recycled, and in-memory variables do not survive a cancellation or an idle period.

**Anti-hotlink protection comes in two flavours.** For SSPAI, a `fetch` from the content script is enough: it carries the page origin, the CDN answers 200, and the bytes reach the downloader as a `data:` URL. `declarativeNetRequest` cannot solve this on its own — `chrome.downloads` requests are issued by the browser process, so `modifyHeaders` never sees them. The other flavour really needs a `Referer`, and an in-page `fetch` is blocked by CORS: Douban's image host (`doubanio.com`, 418 without it) and Weibo's (`sinaimg.cn`, 403) fall here. Those go through a static DNR rule that sets the header plus `fetchMedia`, which pulls the bytes in the service worker and inlines them as a `data:` URL. The rules live in `rules/douban-referer.json` and `rules/weibo-referer.json` and are scoped to `xmlhttprequest` only, so they never rewrite an image you open directly. Where a CDN serves a plain URL to anyone (Xiachufang), the URL is handed straight to the downloader with no fetch at all.

## Tests

```bash
npm i playwright && npx playwright install chromium

# Loads the repository root by default; can also point at another extension directory
EXT_DIR=/path/to/extension node test/panel-fit.mjs
node test/unit-kind.mjs
```

Tests fall into two groups: `unit-*` run assembly and formatting logic directly in Node (with stubbed `chrome`); the rest use Playwright to launch a real browser,
load the extension, feed it real page snapshots, and assert on what gets downloaded. Assertions revolve around the two invariants above; there is no pixel comparison.

Page snapshots (`test/fixtures/*.html`) are not committed for copyright reasons; tests that need them require you to supply your own.

## Privacy

- No data collection, no telemetry, no communication with any server
- All network requests happen only on the site you are browsing and its image/video CDNs, solely to fetch content back and write it locally
- Four `permissions`, matching `manifest.json` one to one:
  - `downloads` — writing files to disk
  - `scripting` — running the extractor in the MAIN world of Xiaohongshu pages to read the raw note object
  - `storage` — remembering panel options
  - `declarativeNetRequestWithHostAccess` — adding a single `Referer` request header for the Douban and Weibo image hosts (two static rules under `rules/`)
- Five `host_permissions` in total — Xiaohongshu pages, the Douban and Weibo image hosts, and SSPAI's two static-asset domains: reading note data on Xiaohongshu, and fetching image bytes in the background for Douban and Weibo (bare requests return 418 and 403 respectively)
- `content_scripts` cover the eleven supported sites only (the capsule plus that site's adapter) and add no entries to `host_permissions`

## Disclaimer

This project is intended solely for **local backup of content you have already legally accessed**. Users must comply with the terms of service and content copyright of the target sites.
Do not use it for bulk scraping, redistribution, or commercial purposes. Copyright in all text and images in the output belongs to the original authors.

## License

[Apache-2.0](./LICENSE). No third-party runtime dependencies (no bundler, no external libraries).
