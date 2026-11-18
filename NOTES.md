# option-brief 坑记录

做这个插件时踩到、且下次还会踩的东西。症状 / 根因 / 解法 / 再犯条件。

## 1. `userQuestions` 会话投影只跟踪 timed 版 `ask_user_question`

- 症状：面板死活不弹；诊断显示 `userQuestions` 投影 `active` 永远是 `[]`，即使提问卡片就在屏幕上。
- 根因：`dsh-user-questions` 的投影 `applyUserQuestionEvent` 在 `tool/call` 分支第一行就是 `if (!fold.timed) return fold;`；`timed` 来自 `request/header` 里 `ask_user_question` 工具 schema 是否声明了 `timeout` 参数。本会话的工具 schema 没有 `timeout`（blocking 旧版），所以整条投影恒为空。
- 解法：别用这个投影做"有没有待回答提问"。改读 `ctx.uiSession.sessionStatus`，取 `statuses.get(sessionId).pendingInteraction`；它同时覆盖 `question` / `plan-review` / `approval`，与 schema 无关。
- 再犯条件：任何"根据提问状态做 UI"的插件，先打印工具 schema 确认是不是 timed 版，或者干脆只用 `pendingInteraction`。

## 2. 客户端的 `remote.workspaceFiles.read` 的 `offset` 必须 ≥ 1

- 症状：HTML/文本预览显示「预览失败 · offset must be a safe integer of at least 1」。
- 根因：`WorkspaceFileRange.offset` 是 1 起的行号，我按 0 起传了 `{ offset: 0 }`。
- 解法：`{ offset: 1, limit }`。
- 再犯条件：任何分页读文本的地方。

## 3. 右侧栏 tab 的标题要单独注册，并且要带 `locale`

- 症状：tab chip 显示成字面量 `tab.title`。
- 根因：`sidebar.right.pane.tab.title` 是另一个 keyed slot，body 的 `locale: NS` 不会带到 title 上。
- 解法：title 注册也要 `{ name: 'sidebar.right.pane.tab.title', key: TYPE_ID, locale: NS }`。
- 再犯条件：给右侧栏加 tab 的任何时候。

## 4. 官方右侧栏的 tab 类型可以注册（不用 shadow）

之前以为 `rightbar.session` 是 single、只能整块替换，实际 `sidebarRightTabs`（`ctx.sidebarRightTabs.register({id, kind, title})`）+ `ctx.sidebarRight.openTab(kind, {params})` 就能加自己的 page 型 tab，body 挂 `sidebar.right.pane.tab`（key = 定义 id）。悬空 issue：`params` 的类型按 kind 生成，本包 kind 不在 map 里，类型上不合法但运行期能过。

## 5. 客户端插件改完只要刷新页面，不用重启 App

- 实测：`Ctrl+R`（Electron 渲染进程 reload）之后新 `client.js` 生效，`cordis_inspect_query` 里 `sidebar.right.pane.tab` 的 occupant 仍是 `active: true`。
- 根因：本地目录安装是 link 进 profile，bundle 每次请求从工程目录读。
- 注意：刷新会重连页面，不影响 Host 侧正在跑的 turn。

## 6. 验证手段：没有浏览器控制时用窗口截屏

- 本机 Electron 不在 `--remote-debugging-port`，装不了 CDP；但可以用 `System.Drawing` 抓主窗口 + `read_image` 看实际渲染，连小字都读得出来。
- 临时诊断行（注册到 `conversation.composer.dock` 的一行状态文本）是拿运行时状态的唯一便宜办法；`console` 看不到。
- 发送 `Ctrl+R`：`WScript.Shell.AppActivate(pid)` + `[System.Windows.Forms.SendKeys]::SendWait('^r')`，记得先 `Add-Type -AssemblyName System.Windows.Forms`。
- 想看长面板的下半截：先 `ShowWindow(h,3)` 最大化（屏幕 1080p 下能一屏看两条选项），抓完再 `ShowWindow(h,9)` 还原。鼠标滚轮要移到面板右侧边缘之外才滚面板，落在 iframe 上只会滚 iframe。

## 7. 千万别用 PowerShell 往返改写 UTF-8 源码（这次把 client.js 写坏了）

- 症状：`Get-Content -Raw` + `Set-Content -Encoding UTF8` 改一行的操作之后，`node --check` 报 `Invalid or unexpected token`，中文全变 `锛?`。
- 根因：Windows PowerShell 的 `Get-Content` 默认按 ANSI(936) 解码，UTF-8 中文被误解码；写回 UTF-8 后字节已变，且部分字符（如 `，`、`。`、`…`、`：`）在 GBK 里不可映射，直接丢成 `?`/U+FFFD，不可逆。
- 解法：改文件只用 `edit`/`write` 工具，或者用 node 脚本（`fs.readFileSync(p,'utf8')` / `writeFileSync(p, text, 'utf8')`）。已经写坏时：`UTF8.GetString(GBK.GetBytes(mangled))` 能救回大部分，但丢掉的字符要逐行补（这次 9 行），并且必须再跟 `locale/*.json` 对拍校验。
- 再犯条件：任何"用 shell 顺手改一行源码"的念头。

## 9. tab body 必须自己当滚动容器

- 症状：面板内容比窗口高，滚轮落在面板上会把**对话**滚走，面板自己不动；PgDn 也没反应。
- 根因：右侧栏给 tab body 的座位不替内容做 overflow；官方 tab（文件树等）是自己在根节点上 `height:100%; min-height:0; flex:auto` 再做内部滚动。
- 解法：`.ob-root{box-sizing:border-box;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}`。
- 验证：滚轮停在面板内、iframe 之外时，面板滚动、对话不动（截屏对比确认）。
- 再犯条件：任何往右侧栏塞长内容的插件。

## 8. 结果样例要按设计宽度渲染再缩放

- 症状：HTML 样例直接塞进 ~500px 的 iframe，桌面版式被响应式挤成一列，看不出设计。
- 解法：iframe 固定 960×620 渲染，外面套一层测量宽度的容器，`transform: scale(宽/960)` + `transform-origin: top left`，容器高度 = 620×scale；`ResizeObserver` 重算。
- 代价：缩放后正文偏小（0.52 倍），要读字还是点开官方预览。