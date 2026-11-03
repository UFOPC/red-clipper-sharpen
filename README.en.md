# Xiao Hong Xia · Download Assistant

> A Chrome / Edge extension (Manifest V3) that saves Xiaohongshu notes, Chiphell threads, SSPAI articles,
> and SMZDM (smzdm.com) articles — together with their images, videos, and comments — as a Markdown file
> with YAML frontmatter plus the media files in the same folder.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[中文](./README.md) · **English**

> **Note:** the extension UI is Chinese-only, and all four supported sites are Chinese-language platforms.
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
| Naming | `<author>/<title>/YYYY.MM.DD_<title>_<author>.md`, illegal characters replaced, no cross-platform oddities |

## Supported sites

| Site | Content | Notes |
|---|---|---|
| Xiaohongshu | Image-text notes, video notes (quality selectable), Live Photos, original video, comments | Offers "Body", "Body + Comments", and "Images: Download / Skip" |
| Chiphell | Thread body and all images | Supports "OP only" (`authorid`) and cross-page threads |
| SSPAI | Article body, images, comments | Direct image requests return 403; bytes are fetched by the content script |
| SMZDM | Article body, images, in-page video, comments | Image `.jpg` suffixes are unreliable; MIME must be restored |

## Installation

**From a Release**

1. Download the latest `XHX-<version>.zip` (XHX is short for 小红虾) and extract it to a permanent folder (not the Desktop — it disappears when the Desktop is cleaned)
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
Jane Doe/
└── S101 Canyon Weekend/
    ├── 2026.08.03_S101 Canyon Weekend_Jane Doe.md
    ├── 2026.08.03_S101 Canyon Weekend_Jane Doe-1.png
    └── 2026.08.03_S101 Canyon Weekend_Jane Doe-2.mp4
```

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

1. **The number of `![N](./…)` references in the body == the number of media files in the same folder == the count shown on the panel.** Any mismatch is a bug.
2. **Relative paths in the `.md` must be valid URIs.** A title with spaces produces a filename with spaces, and a CommonMark link destination is truncated at whitespace —
   `![1](./a b.png)` renders as plain text and no image shows up. Paths are therefore escaped as `%20`, `%28`, and so on.
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

**SMZDM's comment authors.** `.display-nickname` appears 40 times on the page and all of them are **comment** authors; the body author exists only in `meta[property="article:author"]`.

## Project structure

```
manifest.json          MV3 manifest: four content scripts + one service worker
js/
  background.js        message routing, IndexedDB staging, Xiaohongshu fetching and assembly
  rn-format.js         naming / frontmatter / text-image layout / quality tiers, shared by all four sites
  setting.js|css       options page (site list and version number)
content/
  index.js|css         Xiaohongshu: capsule, panel, comment expansion, progress, quality, original video
  chiphell.js|css      Chiphell: Discuz X3 structure, including author mode and cross-page threads
  sspai.js|css         SSPAI: includes hotlink-protection handling
  smzdm.js|css         SMZDM: includes MIME restoration and video decryption
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
| `downloadFiles` | `{data:{files:[…]}}` | Hands over a batch of files directly (used by the three site adapters) |
| `downloadUrl` | `{data:{url, filename, md?, mdFilename?}}` | Downloads media first, then (optionally) writes the md |
| `clearData` / `cancel` | — | Clears staging / cancels the current save |

Staging uses IndexedDB rather than memory: MV3 service workers get recycled, and in-memory variables do not survive a cancellation or an idle period.

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
- Only three permissions are required: `downloads` (writing files), `scripting` (injecting the extractor), `storage` (remembering options)

## Disclaimer

This project is intended solely for **local backup of content you have already legally accessed**. Users must comply with the terms of service and content copyright of the target sites.
Do not use it for bulk scraping, redistribution, or commercial purposes. Copyright in all text and images in the output belongs to the original authors.

## License

[Apache-2.0](./LICENSE). No third-party runtime dependencies (no bundler, no external libraries).
