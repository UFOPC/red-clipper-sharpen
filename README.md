# 小红虾 · 下载助手

> 一个 Chrome / Edge 扩展（Manifest V3）：把小红书笔记、Chiphell / 远景论坛帖子、少数派文章、什么值得买文章，
> 连同图片、视频、评论，存成一份带 YAML frontmatter 的 Markdown + 分类媒体目录。

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

**中文** · [English](./README.en.md)

---

## 它解决什么问题

把网页存成 Markdown 的工具不少，但落到「图文混排 + 原图 + 评论」这一步，几乎都要手工收拾：
图片顺序丢了、评论没地方放、文件名带着一堆非法字符、md 里的相对路径渲染出来是死链。

这个扩展只做一件事：**在页面上点一下，得到一个能直接放进笔记库的目录**。

| | |
|---|---|
| 正文 | 保留标题层级、段落、引用、列表；站点自己的装饰性元素（分享栏、推荐位、编辑入口）剔除 |
| 图片 | 按正文出现顺序落盘，扩展名按**真实 MIME** 推，不按 URL 后缀猜 |
| 视频 | 小红书视频按档位（清晰度）选择；什么值得买的站内视频解密防盗链后落盘 |
| 评论 | 可选「正文+回复」，楼层、IP 属地、点赞数、被回复对象一并保留 |
| 命名 | `<标题>/YYYY.MM.DD_<标题>_<作者>.md`；标题中的空白与括号不进路径，作者只留在 MD 文件名；无标题归入 `未命名文件_<作者>_<发布日期>/`，避免不同作者或日期的内容混放 |

## 支持的站点

| 站点 | 域名 | 内容 | 备注 |
|---|---|---|---|
| 小红书 | `xiaohongshu.com` | 图文笔记、视频笔记（选清晰度）、实况图、原视频、评论 | 支持「正文」「正文+回复」「图片下载/跳过」 |
| Chiphell | `chiphell.com` | 论坛帖子正文与全部图片 | 支持「只看楼主」（`authorid`）与跨页翻页 |
| 远景论坛 | `bbs.pcbeta.com` | 论坛帖子正文与全部图片 | 与 Chiphell 共用一套 Discuz 引擎，零新增 JS |
| 恩山无线 | `right.com.cn` | 论坛帖子正文与全部图片 | 同上；站方有滑块风控，脚本化跑会撞验证码 |
| 耳机大家坛 | `erji.net` | 论坛帖子正文、图片、回复 | 帖子不静态化，走 `forum.php?mod=viewthread` |
| 少数派 | `sspai.com` | 文章正文、图片、评论 | 图片直连 403，走内容脚本取字节 |
| 什么值得买 | `post.smzdm.com` | 文章正文、图片、站内视频、评论 | 只认 `/p/` 文章页；图片后缀 `.jpg` 不可信，MIME 要还原 |
| 微信公众号 | `mp.weixin.qq.com` | 文章正文与图片 | 落盘规范与 [Wechat-Sharpen](https://github.com/UFOPC) 管线同构，见下 |

> 表格、弹窗、`manifest.content_scripts.matches` 三处**顺序一致**。浏览器扩展详情页按 manifest 的
> 顺序逐条列出 `*://*.<域名>/*`，扩展改不了那串文案，但可以保证顺序对得上，从上往下逐条能对上号。

## 安装

**从 Release 安装**

1. 下载最新的 `XHX-<版本>.zip`（XHX 即「小红虾」的缩写）并解压到一个固定目录（别放桌面，删了就没了）
2. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）
3. 右上角打开「开发者模式」
4. 点「加载已解压的扩展程序」，选中解压出来的目录
5. 打开任一支持的站点，页面右侧会出现一枚红色胶囊

**从源码安装**：同上，第 4 步选仓库根目录即可 —— 仓库本身就是解压后的扩展目录，没有构建步骤。

> 升级：替换目录里的文件后，回到扩展页点一下该扩展的刷新按钮。

## 用法

| 动作 | 结果 |
|---|---|
| 悬停胶囊 | 展开参数面板 |
| 点胶囊 | 按当前参数直接保存（图文贴＝正文 + 图片；视频贴＝正文 + 所选清晰度） |
| 面板「正文」 | 只存正文与媒体，不带评论 |
| 面板「正文+回复」 | 正文 + 评论区（含楼中楼一层） |
| 面板「图片 下载 / 跳过」 | 跳过则只落 md，媒体一个都不抓 |
| 面板「视频清晰度」 | 档位列表带各档体积，默认选中短边 ≤ 1080P 的最高一档 |
| 下载中再点胶囊 | 取消 |

**不提供批量下载。** 批量要连点几十个详情页、还要写盘权限，对站点不友好，也容易把账号送进风控。

## 产物形态

```
S101峡谷两日游/
├── 2026.08.03_S101峡谷两日游_张三.md
├── 2026.08.03_S101峡谷两日游-comments.json
├── images/
│   ├── 2026.08.03_S101峡谷两日游-01.png
│   └── 2026.08.03_S101峡谷两日游-02.jpg
├── media/
│   └── 2026.08.03_S101峡谷两日游-01.mp4
└── comments/
    ├── 2026.08.03_S101峡谷两日游-01-c1.png
    └── 2026.08.03_S101峡谷两日游-01-c2.png
```

四个站点共用这套结构。`comments/` 示例中的 `01` 是所属一级评论序号，二级评论沿用所属一级评论的序号；`cN` 是整篇内容内全局递增的评论图序号，不按单条评论重置。

```yaml
---
来源: 小红书
作者: 张三
时间: 2026-08-03_14:22:31
类型: 图文+视频
链接: https://www.xiaohongshu.com/explore/xxxx
---
```

`类型` 按笔记里实际有什么来判：有图有视频 → `图文+视频`，只有视频 → `视频`，只有图或无媒体 → `图文`。
它描述的是**笔记本身**，不随「跳过」这类保存选项变化 —— 否则同一篇贴存两次会得到两种类型。

### 两条不变式

1. **正文引用数 == `images/` + `media/` 中的正文媒体数 == 面板计数。** 三者不等就是 bug。
   `comments/` 中的评论图不计入这条等式；它们在对应评论文字后另有自己的引用。每段被引用的视频只产生一个主文件，不把其他清晰度或原片副本混入计数。
2. **md 里的相对路径必须是合法 URI。** 标题中的空白与括号在命名时移除；作者名等其余片段仍可能含空格或括号，
   而 CommonMark 的链接目标会被这些字符截断或拆坏。因此写入 `images/`、`media/`、`comments/` 的引用仍统一经过 URI 转义。
   （不能用 `encodeURIComponent`：它对 `( ) ' ! *` 一个都不转，括号留在路径里照样把链接拆坏。）

## 四个站点的坑（实测记录）

**少数派的防盗链。** `chrome.downloads.download` 发出的请求带不上 Referer，而 `declarativeNetRequest` 的
`modifyHeaders` 对下载请求完全无效 —— 那是浏览器进程直接发的，不经扩展能改写的链路。解法是内容脚本先
`fetch`（带页面来源，200）→ blob → `data:` URL → 再交给下载器。

**什么值得买的假后缀。** `xxx.png_e1080.jpg` 尾部那个 `.jpg` 是服务端指令，真实返回的是 `image/png`：

| URL | 状态 | 真实类型 | 体积 |
|---|---|---|---|
| `xxx.png_e1080.jpg` | 200 | `image/png` | 697 KB |
| `xxx.png_fo710.jpg` | 200 | `image/png` | 284 KB |
| `xxx.png`（裸地址） | 403 | — | — |

所以扩展名从**指令前面那段**推，不发额外请求探测，也不会因为下载器按 MIME 改名而让 md 引用与落盘对不上。
视频地址是签名过的（`?t=…&sign=…`），**不能**做档位改写，改了就失效。

**Chiphell 的作者模式。** 带 `authorid` 参数进入「只看楼主」时，楼层归属要改判；从第 2 页进入时必须回第 1 页
取元信息（目录名、作者、时间），否则会取到回帖人。

**Chiphell 的附件格。** 作者上传但没插进正文的图，Discuz 排在帖子底部
`div.pattl > ignore_js_op > dl.tattl > div.savephotop` 里，**在 `td.t_f` 之外**。
只扫 `td.t_f` 会整批漏图（实测 tid=2915041：正文 7 张、附件格 29 张，共 36 张）。
`postImages()` / `postBody()` 现按「`td.t_f` + 同楼层附件格」合并，按 URL 去重。

**值得买的评论作者。** 页面上 `.display-nickname` 出现 40 次，全是**评论**作者；正文作者只在
`meta[property="article:author"]` 里。

## 加一个 Discuz 站

Discuz! X3 的帖子页结构在各站之间高度一致，所以四个 Discuz 站共用 `content/discuz.js` 一份引擎：
正文 `td.t_f[id^="postmessage_"]`、作者 `.authi .xw1`、发帖时间 `em[id^="authorposton"]`、
附件格 `.pattl / .tattl`、引用 `.quote`、翻页 `.pg a`、面包屑 `#pt`。

新增站点只要两处改动：

1. `content/discuz.js` 顶部的 `SITES` 里加一条 —— 域名正则、`source` 名、`parse()`（URL → tid/page/authorid）、
   `pageUrl()`（翻页地址）。**不需要写新的 content script。**
2. `manifest.json` 的 `matches` 与 `web_accessible_resources.matches` 加上该域名。

改完用两个脚本验：

```bash
# 老站回归：新旧适配层输出必须逐字节一致（37 个文件 / 36 张图）
PW=… PW_EXE=… node test/regress-discuz.mjs <旧版目录> <新版目录> <帖子快照.html>

# 新站实跑：真页面打开 → 注入 → 点胶囊 → 断言正文与 frontmatter
PW=… PW_EXE=… node test/e2e-real-discuz.mjs https://bbs.pcbeta.com/viewthread-1079227-1-1.html
```

`PW` / `PW_EXE` 指向任意一份 playwright 与 chromium 即可，不必装进仓库。

## 公众号：两套目录树

设置页里可切换，只影响公众号：

| | 通用（默认） | 自用 · 对齐 Wechat-Sharpen |
|---|---|---|
| 目录 | `<标题>/` | `YYYY-MM/YY-MM-DD/` |
| 文件 | `YYYY.MM.DD_标题_公众号名.md` | `<标题>.md` |
| 图片 | `images/<…>-01.png` | `assets/<aid8>_<NNN>_<url8>.<ext>` |
| 引用 | `![1](./images/…)` | `![图片](assets/…)` |
| frontmatter | 来源 / 作者 / 时间 / 类型 / 链接 | title / source / published / created |

「通用」与其他四个站完全一致，**发布版默认**。「自用」复刻 Wechat-Sharpen 管线 ——
`09-Article` 里已有几十篇它的产物，同一目录出现两套命名就没法用一条 Dataview 查。

两个 hash 只是稳定短标识：同一篇文章、同一张图，多次剪藏得到同一个名字；不要求和 Skill 产出的 hash 相同。
`description` / `tags` 一律留空，交给富化阶段补 —— 扩展没有 LLM，不写空壳。

切换写的是 `chrome.storage.local` 的 `layout`，content script 在页面加载时读一次，所以要**刷新文章页**才生效。

**只做单篇手动。** 批量抓取、历史文章导入、订阅推送都留在 Wechat-Sharpen 侧（它有 DB / 书签 / URL 三条来源
和登录态），扩展这边不碰，避免踩微信的批量抓取条款。

## 项目结构

```
manifest.json          MV3 清单：四个 content script + 一个 service worker
js/
  background.js        消息路由、IndexedDB 暂存、小红书取数与组装
  rn-format.js         命名 / frontmatter / 图文混排 / 清晰度档位，四个站共用
  setting.js|css       设置页（站点列表与版本号）
content/
  index.js|css         小红书：胶囊、面板、评论展开、进度、清晰度、原视频
  discuz.js|css        Discuz! X 通用引擎（Chiphell / 远景）：作者模式、跨页、附件格
  wechat.js            微信公众号：与 Wechat-Sharpen 同构的落盘规范
  sspai.js|css         少数派：含防盗链处理
  smzdm.js|css         什么值得买：含 MIME 还原与视频解密
  format-size.js       体积格式化（1000 进制，不引库）
setting.html           设置页
test/                  Playwright 端到端用例
```

### 后台消息协议

内容脚本通过 `chrome.runtime.sendMessage` 与 service worker 通信：

| `type` | 载荷 | 作用 |
|---|---|---|
| `getNote` | `{downloadId}` | 进页面 MAIN 世界取原始 note 对象 |
| `saveData` | `{downloadId, withComment, rnOnly, videoUrl, skipMedia}` | 组装文件清单并写入 IndexedDB |
| `download` | `{downloadId}` | 按清单逐个落盘 |
| `downloadFiles` | `{data:{files:[…]}}` | 直接下发一批文件（三个站适配层用这条） |
| `downloadUrl` | `{data:{url, filename, md?, mdFilename?}}` | 先下媒体，再（可选）写 md |
| `clearData` / `cancel` | — | 清暂存 / 取消当前保存 |

暂存走 IndexedDB 而不是内存：MV3 的 service worker 会被回收，内存变量活不过一次取消或一次空闲。

## 测试

```bash
npm i playwright && npx playwright install chromium

# 默认加载仓库根目录；也可以指向别处的扩展目录
EXT_DIR=/path/to/extension node test/panel-fit.mjs
node test/unit-kind.mjs
```

用例分两类：`unit-*` 在 Node 里直接跑组装与格式化逻辑（打桩 `chrome`），其余用 Playwright 起真实浏览器
加载扩展、喂真实页面快照、断言下载到的东西。断言围绕上面那两条不变式，不做像素比对。

页面快照（`test/fixtures/*.html`）因版权原因不入库，缺快照的用例需要你自备。

## 隐私

- 不采集任何数据，不发遥测，不与任何服务端通信
- 全部网络请求只发生在你正在浏览的站点与其图片/视频 CDN 上，目的仅是把内容取回来写到本地
- 只需要 `downloads`（落盘）、`scripting`（注入取数）、`storage`（记住选项）三项权限

## 免责声明

本项目仅用于**个人已合法访问内容的本地备份**。使用者需自行遵守目标站点的服务条款与内容版权，
请勿用于批量抓取、二次分发或商业用途。产物中的文字与图片版权归原作者所有。

## License

[Apache-2.0](./LICENSE)。无第三方运行时依赖（无打包、无外部库）。
