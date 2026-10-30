# Remote Agent — QwenPaw channel integration

## 命名与定位

界面上的 Provider 名称是 **Remote Agent**，与 **Local models** 并列；**QwenPaw 是
首个可用的后端实现**，不是 Provider 本身。为保持兼容，协议、存储键
（`qwenpaw.mode`、`qwenpaw.connection`、`qwenpaw.credential`）、路由
（`/qwenpaw`、`/settings/qwenpaw`）和前端客户端（`QwenPawClient`、
`useQwenPawChat`）仍沿用 `qwenpaw` 命名空间；后续新增后端不改动这些既有标识。

## 当前状态

第一版后端选择独立安装的 `page_assist` 频道插件，位于相邻独立仓库
`qwenpaw-channel-page-assist/`，不改宿主核心，宿主使用 pip 发布版。
频道在 QwenPaw 同一进程中监听
专用端口（默认 `127.0.0.1:8766`），绑定一个 Agent。普通 Console URL 或
OpenAI API 不能替代此地址。安装及配置参见插件 README。

首版支持文字、显式网页分享、独立聊天和追问，并可随消息上传图片／文件／网页截图
附件；显示完整消息，不提供逐 token 增量、全局 Agent 发现、断线/重启恢复或审批事件推送。
新版扩展与 0.1.3 频道进一步支持**回复媒体**：Agent 回复中的图片就地预览，图片与文件一律
附带可保存的附件条（保留原始文件名），字节按需经同一条带凭据的受保护路由取回，服务端不暴
露本机路径。频道未声明该能力时回复仍只显示文字，与旧版行为完全一致。
频道声明 `recovery=false`、`approvals=true`、`approvalEvents=false`、
`attachments=true` 与 `media=true`；前端展示限制提示，
不自动恢复断线，收到终态事件才解锁下一次发送。待审批不再写入对话消息，
而是由输入框工具栏的审批按钮提示：无待审批时按钮置灰，有待审批时高亮并显示
数量，点击弹出气泡完成批准或拒绝。前端每 5 秒轮询对账，不依赖推送。
审批复用原生 ApprovalService 的记录与决定入口，不自动批准；归属无法确认
或当前版本不支持的审批仍在原生 Console 处理。

频道重新实例化时 instanceId 改变，旧浏览器缓存不再显示，需要新建聊天。
内存历史不是原生会话历史的跨重启查询接口。原生记忆及副作用仍遵循服务端策略。
一个共享 token 对应一个浏览器用户及绑定 Agent，不提供逐工具 scope 或多用户授权。
真实模型、记忆和审批服务仍需在已配置的 QwenPaw 环境中验收；确定性测试不代表
这些能力已联调通过。

**入口**：Chrome 侧边栏 header 左侧、Page Assist 字样之后是两态切换器
（Local models ↔ Remote Agent），Remote Agent 一侧沿用 `website/public/paw.png`
爪子图标，悬停显示名称；图标保存在 `src/assets/qwenpaw-paw.png`，沿用 QwenPaw 的
Apache-2.0 许可，许可副本为 `src/assets/qwenpaw-paw.LICENSE`。切换只重写
`qwenpaw.mode`（同时把聊天模式重置为 normal）并跳转到对应路由，两种引擎各自持有
会话，互不销毁。Firefox 版本不提供 Remote Agent 入口（MV2 缺少
`chrome.storage.local.setAccessLevel`），options 与侧栏设置页也不显示该 Tab。

**首次引导**：本地既没有 provider 记录、也没有保存过 Ollama URL 时，侧栏空态顶部
显示 “Choose how you want to chat” 卡片，Local models 与 Remote Agent 并列；选中
Remote Agent 且尚未配置时，连接表单直接内联展开，保存成功后进入远程聊天。
已有配置时不再显示该卡片，仍可通过切换器随时改选。

**配置入口**：Remote Agent 与 Ollama、OpenAI compatible API 一样拥有独立设置 Tab
（`/settings/qwenpaw`），options 页与侧栏设置页共用同一份连接表单，不再混入
General Settings（侧栏的 Ollama 配置所在页）。

远程页面不挂载普通聊天发送容器，不调用本地 RAG、MCP、记忆或默认 Prompt，
不接收普通右键摘要／翻译的自动提交事件。选区分享使用远程页面中的独立读取按钮。
返回 Local models 不改动原模型配置；Web UI 不新增远程发送入口。

### 原生聊天界面复用

远程模式与普通侧边栏共用 `SidepanelHeaderFrame`、`SidepanelComposerSurface`、
`SidepanelTextarea` 和 `PlaygroundMessage`，而不是挂载包含 Ollama／本地工具
副作用的普通聊天控制器。消息气泡、代码高亮、表格、复制、动态输入框、
Enter／Shift+Enter／输入法处理、聚焦快捷键和智能滚动复用原生实现。
两种模式还共用输入区宽度与布局、工具栏间距、模型／Agent 图标菜单和发送控件。
同一会话的重新提交不再先清空消息列表再拉取历史：内容塌缩会把视图钳到顶部，
重建会误关自动跟随，现改为原位替换。向上翻阅时发送则停留在阅读位置，不强制
跳回底部，与本地聊天行为一致；内容塌缩引起的滚动位置下降不再被当作用户上滚。
默认使用原生“提交 + 下拉选项”，开启小屏优化时两者均改为圆形发送按钮和“更多”
工具菜单。Enter 发送偏好可在发送下拉或小屏“更多”菜单调整。
Agent 图标菜单取代模型菜单；第一条消息自动创建频道会话，后续问题沿用该会话。
已有会话的 Agent 绑定不可改变；顶部新建按钮返回空白聊天，可重新选择 Agent，
发送第一条问题时才创建绑定到该 Agent 的会话。
顶部动作依次为新建远程聊天、远程会话历史、连接详情（频道限制、发送按键偏好、
连接状态）和设置；设置按钮进入侧栏设置页，Remote Agent 的配置在其中的独立 Tab。

输入框网页文档图标打开当前网页／选区读取和预览，发送下拉也提供“与当前网页聊天”
入口。Remote 不显示 Search Internet 和 MCP 入口，包括小屏“更多”菜单；
这些工具由远程 Agent 管理，Local 模式的对应入口保持不变。
正文仍使用原生
`defaultExtractContent`（Defuddle → Markdown）解析器，但先去除表单等敏感 DOM。
预览确认、超限截断和发送前新鲜度检查保持不变；发送后取消当前网页勾选，
避免下一条问题无意重复附带。PDF、视频字幕和特殊站点的额外网络抓取尚未接入。
网页预览不会触发本地嵌入、检索或模型摘要。

当连接的频道声明附件能力时，输入工具栏的图片、截图与文件按钮变为可用：选择、
粘贴或拖入文件后先上传到服务端，并以待缩略图／文件名展示的附件 chip 暂存，发送时
随消息引用已确认的附件；有就绪附件时允许空问题。截图按钮捕获当前可见标签页
（与本地 vision 相同的 `captureVisibleTab` 路径），生成的 PNG 走同一条附件上传
链路，因此 `vision` 与图片／文件共用同一个能力开关。附件默认全画质直发：仅当
图片超过频道单附件上限（默认 5 MiB）时才按最长边 2560→1024 px 的阶梯重编码为
JPEG；若请求被频道前方的中继以 413 拒绝（如反向代理的 body 上限低于 base64 膨胀
后的体积），图片会激进压缩到 700 KB 以内（base64 后小于 1 MiB）并单独重试一次，
其余情况仍明确报错、不盲目重发。OCR 仍以禁用状态展示并说明
原因，小屏优化时收进“更多”菜单。语音转文字听写、TTS 朗读回复与
快捷 Prompt 插入都在浏览器本地完成，对任何后端都可用。频道不支持的消息编辑重生
成、分支、继续生成和临时聊天仍不提供操作；粘贴或拖入文件在频道未声明附件能力时
明确报错。远程消息使用同一 Markdown／CodeBlock 组件的安全模式：不加载回复正文内
引用的远程图片、不执行 HTML／SVG 预览、不写入普通聊天的引用回复状态；该限制只针对正文
内嵌的图片，频道显式声明的回复附件按下文单独处理。TTS 朗读仍
仅在用户开启“Web UI 朗读”时触发，不是无条件的自动朗读。原生本地聊天保留默认渲染
和工具行为。

回复媒体只在 Remote 路径渲染，并完全由所连频道声明的 `media` 能力开关控制。历史与 SSE
快照中的消息因此多出一个 `attachments` 数组，每一项要么带服务端 `mediaId`，要么是一个
公共 `http(s)` 链接。`mediaId` 项由扩展用当前 Bearer 凭据取回字节，再换成 object URL
预览或下载——`<img src>` 不能直接指向受保护路由，凭据也不会出现在 URL 里；IndexedDB 只
保存元数据，重开聊天会按需重新取回，断开或切换连接时集中 revoke。不论图片还是文件，每
个附件只对应一个附件条，承载显示名与保存动作：仅有缩略图是无法下载的，所以取回成功的图
片既就地预览也列在附件条里，仍在取字节的数据显示转圈而不是消失，永久失败的数据给出可读
的过期说明而不是坏掉的缩略图，回复因此不会显得比服务端实际发送的更短。公共链接项直接使
用：预览照常，附件条在新标签页打开（跨源链接上的 `download` 属性会被浏览器忽略，无法保
留原始文件名，因此不承诺静默落盘），服务端不代为抓取外部资源。Local models 路径不使用这
套映射，本地聊天的图片来源、工具行为与渲染保持原样。

### 能力矩阵

`src/services/provider-capabilities.ts` 是 Provider 能力的唯一判定来源：Local models
除“审批卡片”外全部开启，Remote Agent 保留聊天、页面上下文、历史、新建会话与
审批卡片；图片／文件上传按连接频道声明的附件能力动态开启。回复中的媒体不进入这张表，
它只由所连频道声明的 `media` 能力决定，与上传能力互不影响。

| 能力 | Local models | Remote Agent |
| --- | --- | --- |
| 聊天、页面上下文、会话历史、新建会话 | 支持 | 支持 |
| 语音转文字听写、TTS 朗读、快捷 Prompt | 支持 | 支持（浏览器本地实现） |
| 图片、文件与网页截图上传 | 支持 | 支持（需频道声明附件能力；截图在扩展本地捕获后作为图片附件） |
| 回复中的图片预览与附件保存 | 不适用（本地回复不携带附件） | 支持（图片与文件都有下载入口；需频道声明 `media` 能力，旧频道仍只显示文字） |
| RAG、联网搜索、MCP、临时聊天、逐会话模型参数 | 支持 | 不支持 |
| OCR、Page Action、WebMCP | 支持 | 不支持 |

不支持项在输入工具栏以禁用状态展示并给出原因（小屏收进“更多”菜单），空态与设置页
不再渲染对应入口，避免用户误以为可用。审批能力由频道声明的 `approvals` 决定；
基础频道声明 `approvals=true`，侧栏直接处理原生待审批，无需跳转 Console。
审批入口与上传图片、插入网页内容等按钮同排：无待审批时为灰色禁用态，有待审批时
变色并显示数量角标，点击后以气泡展示工具、目标、风险与授权范围。气泡高度随
视口自适应，目标细节完整展开、不做内部滚动截断，批准与拒绝选项无需下拉即可见。

## Configuration and privacy

- Use a service **origin**, e.g. `https://paw.example.com`. HTTP is accepted only
  for `localhost`, `127.0.0.1` or `[::1]`. URL credentials, paths, queries and
  fragments are rejected. The API prefix is always `/api/page-assist`.
- All requests use `Authorization: Bearer <browser-specific credential>`,
  `credentials: omit`, no redirects and no HTTP cache. Do not use administrator
  credentials. The service must enforce the restricted credential's scope.
- The optional Console URL is user-configured, same-origin, without embedded
  credentials, queries or fragments. No model-generated Console link is used.
  With the dedicated channel port, leave this empty and open the original Console
  separately; the same-origin restriction is deliberately preserved.
- Configuration and credential keys use the `qwenpaw` namespace in extension-local
  storage, never sync storage. Local storage access is restricted to trusted
  extension contexts with `setAccessLevel`; existing content scripts obtain their
  settings through the existing background messages rather than direct local reads.
  Storage access errors prevent remote configuration from proceeding.
- Import **and** export filter the entire remote namespace from both local and
  sync storage. Remote tables are not included in ordinary backups or sharing.
  Save a new connection to rotate its local cache partition, even for the same URL.
- Service instance and authenticated principal identifiers further partition local
  conversations. Changing connection settings aborts subscriptions and removes
  the old scope from the visible page until reauthentication.
- Body snapshots are extracted from a clone of the active top-frame HTML DOM.
  Inputs, forms, editable elements, scripts, frames and embeds are removed before
  extraction. Selection mode reads only selected text. Empty output, PDFs,
  non-HTML and restricted pages fail explicitly. No transcript, PDF download,
  server re-fetch or hidden model summarization is performed.
- Source URL query strings and fragments are removed conservatively, including
  non-sensitive query parameters. Full document URLs are used only in memory for
  navigation checks. The source/content hash is SHA-256 of UTF-8
  `JSON.stringify([sanitizedUrl, mode, content])`.
- The context limit is `min(30000, capabilities.maxContextChars)`, measured in
  JavaScript string units, not tokens. Oversized content requires explicit
  truncation confirmation and another preview. Preview and submission use the
  same snapshot; navigation and content/selection changes require a refresh.
  Unsent snapshots are memory-only and are cleared on conversation changes.
- Each explicit send includes its chosen snapshot; the preview does not promise
  the server has forgotten earlier attachments. This first frontend does not
  optimize away repeated attachments.
- Remote Markdown uses the existing React Markdown/GFM libraries without raw
  HTML, executable code previews, local tool actions or automatically loaded images.
  The one exception is a reply attachment the channel names explicitly: its image is
  loaded on its own, never as HTML or a script, and any attachment source outside
  http(s) is rejected before it reaches the DOM.
- Reply media bytes are held in memory only: they become object URLs, are revoked when
  the connection changes or the panel closes, and are never written to IndexedDB,
  export files or logs. The cache stores just the media id, name, kind, type and size,
  so after a channel restart the id is gone and the transcript says so instead of
  retrying a download that cannot succeed.
- Successfully resolved local caches expire after 30 days. Unresolved requests
  are retained to prevent accidental execution replay; their request payloads
  may contain explicitly shared webpage content. Local cache removal is blocked
  while a request is unresolved. Neither cache expiry nor removal deletes native
  history, memory, server logs or provider data.

## Browser application contract v1

This section fixes the shapes used by this frontend. The Page Assist channel
advertises `recovery=false`, `approvals=true`, `approvalEvents=false`,
`attachments=true` and `media=true`; approval event push and durable recovery
remain future work. These are not built-in Console APIs. JSON responses
must have `Content-Type: application/json`; event endpoints use
`text/event-stream`. Media bytes are the single exception: `GET /media/:id` answers
with whatever type it stored and is read as binary. HTTP failures, including 401, 403,
409 and 429, are displayed and do not trigger write retries or model fallback.

### Capabilities, Agents and conversations

`GET /capabilities`:

```json
{
  "protocolVersion": 1,
  "instanceId": "stable-service-instance",
  "principalScope": "authenticated-scope",
  "maxContextChars": 30000,
  "maxTextChars": 8000,
  "recovery": true,
  "approvals": true,
  "approvalEvents": false,
  "attachments": true,
  "maxAttachmentBytes": 5242880,
  "maxAttachments": 4,
  "media": true
}
```

Core fields are required; instance and principal strings partition caches, not
authorization. Unsupported versions or malformed flags/limits fail closed. The
three attachment fields and `media` arrived after v1: a server that omits them is
simply treated as not supporting uploads, or not sending reply media, and the
transcript stays text-only.

`GET /agents`: `{ "agents": [{ "id": "researcher", "name": "Researcher",
"description": "Optional description" }] }`.

`POST /conversations`: `{ "agentId": "researcher" }` →
`{ "conversationId": "server-generated-id", "agentId": "researcher" }`.
The returned Agent must match the selected Agent. A chat remains bound to that
Agent; selecting another Agent only affects an explicit new-chat action.
Creation is not automatically retried after an ambiguous response or cache error.

### New messages and recovery

`POST /conversations/:id/messages`:

```json
{
  "requestId": "client-uuid",
  "text": "A new question, without prior conversation history",
  "pageContext": {
    "type": "webpage",
    "mode": "article",
    "title": "Example",
    "url": "https://example.com/article",
    "capturedAt": "2026-10-24T07:00:00Z",
    "content": "Exactly the previewed Markdown",
    "contentHash": "sha256:...",
    "truncated": false
  },
  "attachments": [{ "attachmentId": "uploaded-attachment-id" }]
}
```

`pageContext` is omitted unless explicitly shared; mode may also be `selection`.
`attachments` is omitted for text-only messages; each entry references a prior
`POST /attachments` upload and at most `maxAttachments` may ride one message.
The response and `GET /requests/:requestId` both return
`{ "requestId": "...", "conversationId": "...", "state": "accepted" }`.

States: `accepted`, `running`, `waiting_approval`, `completed`, `failed`,
`cancelled`, `unknown`. Only `completed`, `failed` and `cancelled` unlock a
resolved request; `unknown` is not safe to resend.

The frontend transactionally saves the request ID, exact payload and user-message
placeholder **before** sending. Local transactions reject another unresolved
request in the same conversation, preserve same-ID/same-payload requests and reject
same-ID/different-payload conflicts. The backend must enforce these rules too.

`GET /conversations/:id/messages` returns **complete, authoritative** visible
history in chronological order:

```json
{
  "conversationId": "server-generated-id",
  "complete": true,
  "messages": [
    {
      "id": "stable-message-id",
      "requestId": "client-uuid",
      "role": "assistant",
      "content": "Visible response, without hidden reasoning",
      "attachments": [
        {
          "mediaId": "server-uuid",
          "kind": "image",
          "name": "chart.png",
          "mediaType": "image/png",
          "bytes": 12345
        }
      ],
      "status": "complete"
    }
  ]
}
```

Only `user` and `assistant` roles are accepted in v1. IDs must be unique within a
conversation. `attachments` is optional on either role and a missing field means
nothing was attached. Each entry has exactly one readable source: a `mediaId` served
by `GET /media/:id`, or a `url` the channel forwarded without storing bytes (then
`bytes` is 0). `kind` is `image` or `file`; a non-http(s) URL, an entry with neither
source or more than 8 entries on one message is rejected as malformed rather than
turned into that many downloads.
Partial/paginated history (`complete: false`) is rejected rather
than silently replacing complete cached output with a summary. Pagination requires
a subsequent protocol extension.

`GET /requests/:requestId/events` uses SSE JSON data, with a `type` in every DTO:

| Type | Additional fields besides `requestId` |
| --- | --- |
| `request.state` | `state` |
| `message.snapshot` | `messageId`, `content`, `attachments`, `status` |
| `message.delta` | `messageId`, `delta` |
| `request.error` | `code`, `message` |
| `request.terminal` | `state` |

Every subscription, including reconnects, must send a snapshot for each message
before that message's deltas. Snapshots replace output rather than appending
replayed text. Reply media travels only with a snapshot: a delta updates the text and
must leave the attachments already shown untouched. UTF-8 chunk boundaries, LF/CRLF,
comments and multiline data are supported. Incomplete events at EOF are discarded; EOF
is never success.
Frames are limited to 2 million string units.

After terminal signals or interrupted output, the controller reconciles state
and history. It makes up to three read-only stream subscription attempts and
exposes a manual reconnect. Writes are never automatically retried.
If recovery is unavailable or cannot establish an outcome, the request remains
unresolved and blocks another send. A fresh accepted request can subscribe without
recovery support, but an interrupted/finished stream still cannot fabricate a
confirmed outcome. A fully usable continuous-chat deployment should advertise
and implement recovery.

Closing the sidebar or stopping display aborts subscriptions only. There is no
remote cancellation button, regenerate, edit, branch, queue,
client memory or temporary/non-retention mode.

### Attachments

`POST /attachments`: `{ "name": "shot.png", "mediaType": "image/png", "data":
"<base64>" }` → `{ "attachmentId": "server-uuid", "name": "shot.png", "kind":
"image", "mediaType": "image/png", "bytes": 1234 }`. The decoded payload is
capped by `maxAttachmentBytes`. The server classifies real images by magic
bytes (everything else as a file), sanitizes the display name and stores the
bytes inside the bound Agent workspace; the Agent receives them as image/file
content rather than inline chat text. Each `attachmentId` is consumed by one
message; a reference to an unknown or already-used id fails with `400`, and the
browser re-uploads on retry rather than resending the reference. Uploads are
never automatically retried after an ambiguous response. A relay 413 in front of
the channel is an explicit rejection with no server-side effect, so images hit by
one are re-encoded to a relay-safe size and uploaded once more; that fallback
never applies to non-image uploads or resends a consumed attachment id.

### Reply media

`GET /media/:mediaId` returns the bytes the channel buffered for one attachment under
the same bearer token as every other route, with the stored `Content-Type`. Ids are
opaque UUIDs, so no server path or filename is ever readable from the URL; the display
name comes from the message's `attachments` entry. An unknown, malformed or already
evicted id is a plain `404`. Stored images are served `inline` and everything else as
an attachment download, so nothing buffered here can render as a page.

The frontend reads these bytes itself and shows them as object URLs: an `<img>` cannot
carry the credential, and the id must not end up in a URL another page could load.
Each id is attempted at most once per connection, failures are per message and per id,
and only the metadata is cached — reopening a conversation re-reads the bytes with the
current token, and changing or closing the connection revokes every object URL.
A `404`, typically after a channel restart, becomes an explanatory chip rather than a
broken thumbnail. Every attachment earns exactly one chip whatever its kind, carrying the
display name and the save action: a thumbnail alone cannot be downloaded, so a ready
image is previewed inline *and* listed, one whose bytes are still arriving shows a
spinner instead of vanishing, and a permanently failed one explains itself, so a reply
never looks shorter than the service says it is.

The same route serves uploads back, which is how an image or file the user sent
reappears in history instead of a bare filename. A reply attachment carrying a public
`url` instead of a `mediaId` skips all of this: the channel forwards the link rather
than fetching it, because doing so would turn this listener into an open proxy, and the
browser uses it directly — a preview plus a chip that opens the link in a new tab, since
a cross-origin `download` attribute is ignored and cannot keep the file's real name.

### Native approvals

`GET /approvals` returns all approvals authorized for this browser identity,
independent of which conversation is visible:

```json
{
  "approvals": [{
    "id": "native-approval-id",
    "conversationId": "server-conversation-id",
    "agentId": "researcher",
    "requestId": "client-request-id",
    "tool": "read_file",
    "target": "Trusted native operation details",
    "risk": "Trusted risk information",
    "expiresAt": "2026-10-24T08:00:00Z",
    "actionable": true,
    "scopes": [{
      "id": "exact",
      "label": "Exact target",
      "description": "May remember authorization for this exact target; not necessarily once"
    }]
  }]
}
```

Only service DTOs create cards. Unknown/missing ownership, insufficient details,
expiry or failed reconciliation disables actions. Actions are re-checked against
fresh native details at submission time; the panel never infers scope from model
text. Scope IDs and explanation are service-defined.

`POST /approvals/:id/decision`:
`{ "decisionId": "uuid", "approved": true, "scope": "exact" }`.
Rejection uses `approved: false` and omits `scope`.
Confirmed responses must include `decisionId`, `approvalId`, `approved`,
the matching `scope` for approvals, and `status: "confirmed"`. Other outcomes remain visibly unconfirmed. Decisions are
saved locally before submission; an explicit retry uses the **same** ID and
payload. Disappearing from the pending list is not proof of approval or rejection:
unconfirmed saved decisions remain visible and can require Console reconciliation.
Approving never resubmits the question or executes a tool locally.

The approval list polls every five seconds while the page is open and feeds the
composer button: disabled while nothing is pending, highlighted with a count
when something is. Opening the popover shows the native details.
If `approvalEvents: true`, `GET /events` additionally emits JSON notifications
`{ "type": "approvals.changed" }` or `{ "type": "events.gap" }`; both invalidate
the old buttons and query the authoritative list. Notification failures disable
stale actions, surface an error, and reconnect read-only. Polling remains a fallback.

## Build and validation

```bash
bun run compile
bun run build:chrome
node --experimental-strip-types --test tests/qwenpaw.test.ts tests/duckduckgo-parser.test.ts
node tests/qwenpaw-browser.mjs
node tests/qwenpaw-channel-browser.mjs
```

The browser check uses the existing lockfile's Playwright/esbuild dependencies,
installed Google Chrome, WSLg/a GUI display and a disposable browser profile.
Set `CHROME_PATH` if the executable is not `/usr/bin/google-chrome`.
It copies the production build to a temporary directory, uses only synthetic API
responses, and removes its temporary profile. It does not change your normal
Chrome profile, QwenPaw source or running service.

The separate channel browser check starts the actual plugin's HTTP listener and
native BaseChannel/TaskTracker using the companion repository's test fixture.
It verifies complete replies, follow-ups, failure status, and the no-recovery
lock using a deterministic Agent and in-memory ChatManager test double, not a
real provider or native memory. It stops its own listener afterwards.
Set `QWENPAW_TEST_PYTHON` to the prepared QwenPaw Python interpreter if it is not
the workspace `.venv/bin/python`.

Verified in Node 22.22.0 and Linux Chrome 156: pure protocol/privacy tests,
production build mounting, real IndexedDB v5→v6 upgrade preserving legacy history,
transactional deduplication/conflict/busy/rollback, scope partitioning, continuous
remote conversation, reload without resubmission, article/selection snapshots,
form/editable-content exclusion, exact preview/submission content, explicit
30,000-character truncation, changed-content refusal, synthetic approval decisions
and unknown-request recovery.

Not a substitute for native end-to-end acceptance: actual Agent memory, server
authorization/revocation, native tool execution and remembered approval scope,
multi-client native approval races, process restarts, real authenticated/private
sites, complex page behavior, or Windows Edge compatibility. Ordinary local chat
and Web UI must also be manually regression-tested with the intended model service.

Reload the extension at `chrome://extensions/`, reopen the side panel and refresh
the target webpage after building. Load `build/chrome-mv3`, not the outer `build`
directory. The baseline manifest version remains `1.5.88` (`wxt.config.ts`, not
`package.json`); no release is implied.

The fork milestone is marked by the annotated tag `remote-agent-preview-1` on
`feat/qwenpaw-remote-channel`. Feature development continues on that branch while
`main` only mirrors upstream, so the tag — not a version bump — identifies this
first functional implementation.
