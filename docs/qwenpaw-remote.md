# QwenPaw Remote — basic channel integration

## 当前状态

第一版后端选择独立安装的 `page_assist` 频道插件，位于相邻 QwenPaw 仓库的
`plugins/channel/page_assist/`，不改宿主核心。频道在 QwenPaw 同一进程中监听
专用端口（默认 `127.0.0.1:8766`），绑定一个 Agent。普通 Console URL 或
OpenAI API 不能替代此地址。安装及配置参见插件 README。

首版支持文字、显式网页分享、独立聊天和追问；显示完整消息，不提供逐 token
增量、全局 Agent 发现、断线/重启恢复或浏览器审批卡片。频道声明
`recovery=false`、`approvals=false`、`approvalEvents=false`；前端展示限制提示，
不轮询审批、不自动恢复断线，收到终态事件才解锁下一次发送。
审批必须另行在原生 Console 处理，不自动批准。

频道重新实例化时 instanceId 改变，旧浏览器缓存不再显示，需要新建聊天。
内存历史不是原生会话历史的跨重启查询接口。原生记忆及副作用仍遵循服务端策略。
一个共享 token 对应一个浏览器用户及绑定 Agent，不提供逐工具 scope 或多用户授权。
真实模型、记忆和审批服务仍需在已配置的 QwenPaw 环境中验收；确定性测试不代表
这些能力已联调通过。

在 Chrome 侧边栏顶部点击 **QwenPaw** 进入；首次仍为普通模型模式。
入口采用上游 `website/public/paw.png` 爪子图标，悬停显示模式名称。
图标保存在 `src/assets/qwenpaw-paw.png`，沿用 QwenPaw 的 Apache-2.0
许可，许可副本为 `src/assets/qwenpaw-paw.LICENSE`。
远程页面不挂载普通聊天发送容器，不调用本地 RAG、MCP、记忆或默认 Prompt，
不接收普通右键摘要／翻译的自动提交事件。选区分享使用远程页面中的独立读取按钮。
返回普通模式不改动原模型配置；Web UI 不新增远程发送入口。

### 原生聊天界面复用

远程模式与普通侧边栏共用 `SidepanelHeaderFrame`、`SidepanelComposerSurface`、
`SidepanelTextarea` 和 `PlaygroundMessage`，而不是挂载包含 Ollama／本地工具
副作用的普通聊天控制器。消息气泡、代码高亮、表格、复制、动态输入框、
Enter／Shift+Enter／输入法处理、聚焦快捷键和智能滚动复用原生实现。
两种模式还共用输入区宽度与布局、工具栏间距、模型／Agent 图标菜单和发送控件。
默认使用原生“提交 + 下拉选项”，开启小屏优化时两者均改为圆形发送按钮和“更多”
工具菜单。Enter 发送偏好可在发送下拉或小屏“更多”菜单调整。
Agent 图标菜单取代模型菜单；第一条消息自动创建频道会话，后续问题沿用该会话。
已有会话的 Agent 绑定不可改变；顶部新建按钮返回空白聊天，可重新选择 Agent，
发送第一条问题时才创建绑定到该 Agent 的会话。
顶部历史按钮切换远程会话，信息按钮显示频道限制、发送按键偏好和连接状态。

输入框网页文档图标打开当前网页／选区读取和预览，发送下拉也提供“与当前网页聊天”
入口。Remote 不显示 Search Internet 和 MCP 入口，包括小屏“更多”菜单；
这些工具由远程 Agent 管理，Local 模式的对应入口保持不变。
正文仍使用原生
`defaultExtractContent`（Defuddle → Markdown）解析器，但先去除表单等敏感 DOM。
预览确认、超限截断和发送前新鲜度检查保持不变；发送后取消当前网页勾选，
避免下一条问题无意重复附带。PDF、视频字幕和特殊站点的额外网络抓取尚未接入。
网页预览不会触发本地嵌入、检索或模型摘要。

输入工具栏保留尚未接通的图片、文件、截图／视觉问答和语音入口，
以禁用状态展示，悬停或键盘聚焦显示原因；小屏优化时收进“更多”菜单并列出原因。
OCR 选项同样禁用并说明原因。本轮不新增附件传输接口，也不调用本地工具或模型。
频道不支持的消息编辑重生成、分支、继续生成和临时聊天仍不提供操作；
粘贴／拖入文件明确报错。远程消息使用同一 Markdown／CodeBlock 组件的安全模式：
不加载消息图片、不执行 HTML／SVG 预览、不自动朗读，不写入普通聊天的引用回复状态。
原生本地聊天保留默认渲染和工具行为。

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
- Successfully resolved local caches expire after 30 days. Unresolved requests
  are retained to prevent accidental execution replay; their request payloads
  may contain explicitly shared webpage content. Local cache removal is blocked
  while a request is unresolved. Neither cache expiry nor removal deletes native
  history, memory, server logs or provider data.

## Browser application contract v1

This section fixes the shapes used by this frontend. The basic channel implements
the chat endpoints below with all three optional capability flags set to false;
approval APIs and durable recovery remain future work. These are not built-in
Console APIs. JSON responses
must have `Content-Type: application/json`; event endpoints use
`text/event-stream`. HTTP failures, including 401, 403, 409 and 429, are displayed
and do not trigger write retries or model fallback.

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
  "approvalEvents": false
}
```

All fields are required. Instance and principal strings partition caches, not
authorization. Unsupported versions or malformed flags/limits fail closed.

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
  }
}
```

`pageContext` is omitted unless explicitly shared; mode may also be `selection`.
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
      "status": "complete"
    }
  ]
}
```

Only `user` and `assistant` roles are accepted in v1. IDs must be unique within a
conversation. Partial/paginated history (`complete: false`) is rejected rather
than silently replacing complete cached output with a summary. Pagination requires
a subsequent protocol extension.

`GET /requests/:requestId/events` uses SSE JSON data, with a `type` in every DTO:

| Type | Additional fields besides `requestId` |
| --- | --- |
| `request.state` | `state` |
| `message.snapshot` | `messageId`, `content`, `status` |
| `message.delta` | `messageId`, `delta` |
| `request.error` | `code`, `message` |
| `request.terminal` | `state` |

Every subscription, including reconnects, must send a snapshot for each message
before that message's deltas. Snapshots replace output rather than appending
replayed text. UTF-8 chunk boundaries, LF/CRLF, comments and multiline data are
supported. Incomplete events at EOF are discarded; EOF is never success.
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
remote cancellation button, regenerate, edit, branch, queue, image/file upload,
client memory or temporary/non-retention mode.

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
expiry or failed reconciliation disables actions. Approval modals are checked
again against fresh native details at submission time. Scope IDs and explanation
are service-defined, never inferred from model text.

`POST /approvals/:id/decision`:
`{ "decisionId": "uuid", "approved": true, "scope": "exact" }`.
Rejection uses `approved: false` and omits `scope`.
Confirmed responses must include `decisionId`, `approvalId`, `approved`,
the matching `scope` for approvals, and `status: "confirmed"`. Other outcomes remain visibly unconfirmed. Decisions are
saved locally before submission; an explicit retry uses the **same** ID and
payload. Disappearing from the pending list is not proof of approval or rejection:
unconfirmed saved decisions remain visible and can require Console reconciliation.
Approving never resubmits the question or executes a tool locally.

The independent approval list polls every five seconds while the page is open.
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
directory. The baseline manifest version remains `1.5.88`; no release is implied.
