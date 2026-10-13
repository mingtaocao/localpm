# LocalPM：核心调试体验对齐 Postman 的具体设计

设计日期：2026-10-13。代码基线：`main`，提交 `2c35024525af4b2550db28247a491fc5651ea1f9`，版本 0.7.0。

## 1. 目标与完成标准

把“编辑请求 → 发送 → 阅读响应 → 编写测试 → 查看诊断 → 保存和复用”做成一致、可预测的操作流程。Postman 作为界面结构、交互反馈和脚本语义的参照；交付时按具体动作验收，不以“有按钮、能发请求”作为完成标准。

这份设计覆盖日常 HTTP 调试的六个模块。云协作、监控、Mock 服务、多协议客户端和集合 Runner 不作为本轮交付条件，后续另立设计。脚本兼容按明确的 API 清单交付，不能宣称完整兼容 Postman Sandbox。

实施前固定一份 Postman 桌面版参照：记录版本号，截取请求编辑、响应、Scripts、变量、Console 的浅色/深色界面，并录下本设计验收动作。当前分析没有对用户实际运行的 Postman 或 LocalPM 安装包进行现场操作，像素和运行时故障不能当作已验证事实。

## 2. 代码现状与问题定位

| 体验点 | 当前代码事实 | 判断与设计处理 |
|---|---|---|
| 响应光标不可见 | `src/App.tsx` 响应 CodeMirror 使用 `editable={false}`，未单独设置 `readOnly` | 已确认配置差异：改为可聚焦、可选择、有阅读光标，但文档只读。不是把响应改成可编辑 |
| 请求光标/括号反馈缺失 | Body CodeMirror 使用默认基础配置，仅 JSON 模式加载 `json()`；响应 Pretty 模式加载 JSON；未显式禁用括号匹配 | 本地已安装的 UIW 基础配置默认包含 `drawSelection`、`bracketMatching`。请求区根因尚未确认，应检查焦点、光标颜色、主题、文档重建和语言模式，而不是重复添加扩展 |
| 焦点不明显 | `src/style.css` 有 `.cm-focused { outline: none !important; }`，并统一覆盖 `.cm-editor/.cm-content/.cm-gutters` 的背景和文字色 | 确认存在全局覆盖；它不等于已证明隐藏光标，但会削弱焦点反馈。统一由编辑器主题管理，不再叠加无边界覆盖 |
| 页面状态串联 | `App.tsx` 的 `responseTab`、`responseFormat`、`headerSearch` 是全局状态；请求编辑标签只在 Map 中按请求记录 | A 请求切到 Headers 后，B 请求可能沿用同一视图。改为每个请求标签独立保存编辑/响应视图状态 |
| 保存语义不同 | 集合请求修改后约 2 秒自动调用 `save()`；发送前也会保存集合请求；草稿约 500ms 保存 | 对齐常用显式保存行为：自动保存草稿，Save 才更新集合，Send 使用当前草稿但不隐式覆盖集合 |
| Scripts 只展示 | `App.tsx` 的 Scripts 是警告和 `metadata.event` JSON；`RequestSpec` 没有类型化 scripts 字段 | 需要完整脚本编辑、预设、继承、执行和测试结果，不是增加一个文本框即可 |
| 请求执行已有共用层 | `src-tauri/src/lib.rs` 的 `send_request` 先 `http::prepare` 再 `service.execute`；`service.rs` 负责执行记录、取消、历史和事件 | 保留 HTTP/SQLite/密钥存储。新增执行编排入口，让脚本先于 prepare，手动请求与 MCP 复用同一生命周期 |
| 变量已有基础语义 | `variables.rs` 按 Global → Collection → Environment 覆盖，支持递归替换、未解析/循环报错和密钥读取 | 扩充临时执行作用域和变量来源展示；继续使用后端解析，不能另做一个前端发送解析器 |
| Console 已有诊断 | `ConsolePanel.tsx` 有列表、过滤、请求/响应、网络信息、高度保存；前端最多保留 100 条、响应预览 64 KiB | 继续增强为执行诊断视图；网络记录与脚本日志按 executionId 关联，不能另建互不相干的日志列表 |
| 大响应已有界限 | Pretty 在小于 5 MiB 文本时尝试格式化；截断/二进制响应当前不进入文本编辑器，提示保存完整文件 | 改为可阅读的有限预览，并明确区分原始文件、已加载文本和已格式化文本 |
| 测试已有基础 | `tests/workflow.spec.ts` 使用 Rust HTTP/SQLite 测试桥；另有 preferences、ui-boundaries、workspace-experience 等测试 | 扩展真实操作用例；浏览器测试不能替代 macOS WKWebView 和 Windows WebView2 的光标/输入验收 |

## 3. 界面和状态设计

### 3.1 固定信息结构

- 顶栏：工作区名称、环境选择、变量查看、设置。环境选择始终可见。
- 左侧：集合/环境/历史入口、搜索、集合树；请求方法、名称、未保存标记保持统一。
- 主区：请求标签 → 名称/保存状态 → Method/URL/Send → 请求配置标签 → 请求内容 → 可拖动分隔条 → 响应。
- 请求配置标签：Params、Authorization、Headers、Body、Scripts、Settings。数量角标只计有效内容；Scripts 标记继承和本地脚本数量。
- 响应第一行：HTTP 状态、耗时、大小；第二行：Body、Cookies、Headers、Test Results；Body 内再选择 Pretty / Raw / Preview。
- 底部：Console 和执行状态。Console 能收起、拖高、最大化；最大化可暂时遮盖主区，恢复后还原原布局。

主功能保持固定位置，复制、保存响应等次要动作放在统一工具栏。工具栏的隐藏菜单不能遮掉核心 Send/Save/环境选择。

### 3.2 尺寸与视觉规则

基准正文 14px，代码 14px、行高约 1.6；辅助信息最低 12px。编辑器字号提供 12–20px 设置。使用系统字体和明确的等宽字体回退；光标、选区、焦点、括号、错误、禁用状态各用独立主题 token。

提供 `--editor-cursor`、`--editor-selection`、`--editor-active-line`、`--editor-bracket-bg`、`--editor-bracket-border`。括号高亮同时改变背景和描边；不能只依靠难以分辨的字体颜色。焦点区域有轻量边框，键盘焦点可见。

最小窗口先按 900×640 验收；兼顾 1280×800、1440×900 与系统 125%/150% 缩放。小窗口优先收起侧栏和次要工具，而不是压小文字。正文不在动画中移动，耗时/大小使用稳定数字，减少阅读时跳动。

### 3.3 状态归属

新增 `src/stores/requestTabs.ts`，把 App 内的 Tab 和请求操作迁出。每个标签持有：

```ts
type RequestTab = {
  tabId: string;
  requestId: string;
  draft: RequestSpec;
  savedRevision?: number;
  dirty: boolean;
  saveState: 'draft' | 'saving' | 'saved' | 'failed';
  activeExecutionId?: string;
  latestExecutionId?: string;
  view: {
    requestSection: 'Params' | 'Authorization' | 'Headers' | 'Body' | 'Scripts' | 'Settings';
    scriptStage: 'preRequest' | 'postResponse';
    responseSection: 'Body' | 'Headers' | 'Cookies' | 'Tests';
    responseFormat: 'Pretty' | 'Raw' | 'Preview';
    headerSearch: string;
    wrap: boolean;
  };
};
```

编辑器文档历史、选区、光标、折叠和滚动位置归属于 `(tabId, editorKind)`。不要在每次 React 渲染时销毁 EditorState；切换主题用重配置，切换请求才切换所属文档状态。标签可以恢复视图；响应内容属于 executionId，不能因切换请求被混用。

## 4. 六个模块的具体行为

### 4.1 请求与响应编辑器

新增 `components/editor/CodeEditor.tsx`、`editorExtensions.ts`、`editorTheme.ts`，统一 Body、Scripts、Response 和 Console 文本详情的配置。

| 项目 | 请求 Body / Scripts | 响应 Body |
|---|---|---|
| 聚焦与光标 | 点击定位、可见闪烁光标、当前行 | 点击定位、有阅读光标、当前行，键盘移动与选择 |
| 只读 | 否 | `readOnly=true`，保留可聚焦交互；设置 `editable=true`，用只读状态阻止改文档 |
| 括号 | JSON/JS 的 `{}`、`[]`、`()` 成对高亮；错误括号单独提示 | JSON Pretty 同样支持匹配；Raw 保留文本，不伪造 JSON 语法 |
| 选择 | 拖选、双击词、Shift/方向键、搜索定位、复制 | 同左；粘贴、删除、输入不得改变响应 |
| 格式化 | 工具栏和快捷键；仅格式化合法内容，可撤销 | Pretty 派生格式化；Raw 始终显示原文本 |
| 折叠 | JSON/JS gutter 折叠；展开/折叠全部 | Pretty 可折叠，显示行号 |
| 查找 | Cmd/Ctrl+F；可编辑区支持替换 | 查找支持匹配计数、上下一个；只读区不提供替换 |

请求 Body 根据语言选择加载 JSON/JavaScript/HTML/XML 模式，不再只支持 JSON 的语法能力。新增依赖必须在 package.json 直接声明并锁定，不依赖传递依赖偶然存在。

JSON 格式化失败：保留原文和光标，显示行/列和错误原因，不清空编辑器。请求提交不因 raw JSON 不合法被强制阻止——允许调试非法请求，但显示警告。响应为非 JSON 时不能套用 JSON 高亮；用户可以手动切换展示语言。

复制动作明确分为“复制原始响应”和“复制当前格式化内容”；选区复制由编辑器正常处理。Preview 首批支持已有的隔离 HTML 预览；不执行远程 HTML 脚本，也不伪装为完整浏览器页面。

大内容策略：≤1 MiB 默认 Pretty；1–5 MiB 默认 Raw，用户可主动格式化；>5 MiB 禁止主线程自动 JSON.parse/格式化，进入后台处理或有限预览。20 MiB 等现有预览上限明确显示“预览截断”，完整文件仍由已有 Save response 提供。精确阈值上线前用实测调整，字节与字符长度不要混算。

### 4.2 参数、请求头、认证与变量

`KeyValue.tsx` 增加稳定 rowId；编辑行尾始终有一行空白，填入后创建新空白行；Tab/Shift+Tab 跨单元格，粘贴多行 `key:value`/TSV 可批量导入。启用/禁用、删除、批量编辑转换后保留顺序、重复 key 和空值。避免以数组下标作为 React key 导致删除一行后焦点落错。

URL 与 Params 保持单一解析/编码规则。使用现有 `paramsFromUrl`、`urlFromParams`，补齐重复参数、空值、禁用参数、中文、空格、`{{变量}}`、已有转义和 URL fragment 的测试。后端最终构建结果作为发送事实，不直接把前端预览当作实际结果。

新增变量查看抽屉：输入 `{{` 可补全；悬停显示来源作用域、最终值/脱敏值和未解析原因。优先级设计为临时执行值 > 环境 > 集合 > 全局；本轮不提供数据文件作用域，因此不冒充完整 Postman 五级作用域。Secret 的明文不持久化到 localStorage。

Authorization 显示当前类型、继承来源和生成结果；Headers 将用户输入与自动生成项区分展示，自动项只读。认证导出的格式仍交给 `postman.rs`；暂未执行支持的认证类型明确提示，不出现“选择成功但发送时才无说明失败”。

### 4.3 发送、取消与保存

Send 接收当前草稿、环境 ID 和集合 ID 的冻结快照。运行中按钮变为 Cancel，并标注 Preparing / Sending / Testing 阶段。相同标签默认一次只能有一个活动执行，不同标签可以并发。

发送时保留上一响应，显示“上次结果”直到新执行完成；取消或网络失败时保留上一响应并显示本次错误。用户继续编辑草稿不会改变已开始的请求。结果只更新同一个 executionId 所属标签；已关闭标签的执行记录仍进入 Console/历史，不重新打开标签。

HTTP 4xx/5xx 是已收到响应，不等同于网络失败；断言失败不覆盖 HTTP 成功状态。取消为独立状态，不显示成普通网络错误。

保存规则：500ms 防抖写草稿；显式 Save 或 Cmd/Ctrl+S 更新集合。新请求先选集合/文件夹；失败保留 dirty 和重试入口。关闭未保存标签给 Save / Keep draft / Discard 三个选择；Discard 只删该草稿，不能删集合请求。重启恢复草稿；恢复提示能够定位具体标签。

迁移时移除 `App.tsx` 的“2 秒自动 save 集合”和“Send 前 save 集合”两条隐式行为；这是有意的产品行为变更，需在版本说明中写清。

### 4.4 Scripts、预设与测试结果

界面：Scripts 内有 Pre-request / Post-response 两个子标签；左侧代码编辑器、右侧可收起的 Snippets 搜索列表；顶部展示“继承自集合/文件夹”，继承代码可查看，修改需跳转所属对象。插入预设到当前光标；替换选区时遵循编辑器行为，支持 Undo。

首批预设必须与首批运行 API 完全一致：

| 阶段 | 预设 | 使用接口 |
|---|---|---|
| 请求前 | 设置环境变量、设置临时变量 | `pm.environment.set` / `pm.variables.set` |
| 请求前 | 设置时间戳/UUID、添加请求头 | `Date.now()`、`pm.variables.replaceIn("{{$guid}}")`；`pm.request.headers.upsert` |
| 响应后 | 状态码为 200、耗时小于阈值 | `pm.test`、`pm.expect`、`pm.response.code/responseTime` |
| 响应后 | 检查 JSON 字段、检查响应头 | `pm.response.json()`、`pm.response.headers.get()` |
| 响应后 | 提取 token 保存到环境 | JSON 解析 + `pm.environment.set`；敏感变量走现有密钥规则 |
| 两阶段 | 打印调试值 | `console.log/warn/error` |

`pm.expect` 首批支持 `equal`、`deep.equal`、`include`、`property`、`a`、`below`、`true/false` 与 `pm.response.to.have.status` 等实际预设需要的断言；逐个写兼容用例。不实现的方法返回有名称和行号的 Unsupported API 错误，不能 silently no-op。

支持清单：变量 `get/set/unset/has`、`pm.variables.replaceIn`、请求 URL/headers/raw body 的受控修改、响应 `code/status/headers/text/json/responseTime`、同步 `pm.test`、日志。`pm.sendRequest`、异步回调测试、npm 包、Runner 控制、完整 Chai、CryptoJS 和全部动态变量作为下一阶段兼容项；导入含这些内容时提示差异并保留代码。

脚本结果：响应 Test Results 显示 Passed/Failed/Error/Skipped 数量、用例名、期望/实际摘要、所属脚本作用域及行号；点击定位代码。请求前脚本异常阻止当前网络发送；响应后脚本异常保留收到的响应。单个测试断言失败不终止其后其他测试。

导入的脚本初始仅保存，用户开启当前集合脚本执行后才运行；本地新建脚本可直接启用。MCP 执行同一脚本语义，但开启脚本执行必须纳入集合执行权限，不因读集合就自动授权脚本。

### 4.5 响应阅读

Body / Headers / Cookies / Test Results 独立，返回 Body 时恢复 Pretty/Raw 选择、搜索、折叠和滚动。响应头支持搜索、复制单项、重复同名 header；Cookies 明确显示当前响应的 Set-Cookie，与全局 Cookie 管理器分开。

耗时说明首批只展示实际可测量的总耗时、请求准备和脚本耗时。当前 reqwest 层没有精确 DNS/TCP/TLS 分段证据，因此不能绘制虚假的 Network 时间线。详细网络分段作为后续可观测性改造。

错误面板显示错误类型、原因、重试、查看 Console；点击 Console 时直接选中对应 executionId，避免让用户在列表中再找一次。

### 4.6 Console 与历史

Console 改为“记录列表 + 选中记录详情”，而不是把所有请求正文一直嵌在列表中。详情标签为 Overview、Request、Response、Scripts。请求区明确区分草稿、变量/认证处理后的构建请求、传输层自动添加项；Cookie/Host 等未被捕获的项注明未采集。

按 executionId 关联请求诊断、HTTP 结果、测试和脚本日志。过滤包含请求、日志、HTTP 错误、网络错误、脚本错误；列表可排序，显示阶段、状态、耗时。当前会话保留上限 100 可先保留，列表采用虚拟化；清空 Console 不清除持久历史。

历史读取 executionId、环境 ID/名称和请求快照；“查看历史结果”只读，“以此新建请求”复制到新草稿，不能直接覆盖原集合项。恢复请求时展示当时环境，重发前允许选择当前环境并明确指出变化。

默认诊断、脚本日志、复制和持久历史走现有 `security.rs` 脱敏。手动查看构建请求需要时可在受控界面短暂显示敏感值；MCP 和导出的诊断始终脱敏。正文预览应截断后有明确标识，禁止把展示截断内容当完整请求重发。

## 5. 技术拆分与数据模型

### 5.1 前端拆分

| 文件/模块 | 职责 |
|---|---|
| `App.tsx` | 保留工作区外壳、导航和组合，不再直接实现编辑器/执行完整流程 |
| `stores/requestTabs.ts`（新增） | 标签、草稿、dirty、视图状态、保存操作 |
| `stores/executions.ts`（新增） | executionId 记录、阶段、诊断、日志、测试结果；兼容 MCP 来源 |
| `components/editor/*`（新增） | 统一 CodeMirror、主题、扩展、语言、视图状态与快捷键 |
| `components/request/RequestWorkbench.tsx`（新增） | URL/Send、请求标签和各配置区 |
| `components/response/ResponseViewer.tsx`（新增） | 响应阅读、格式、查找、Headers/Cookies/Tests |
| `components/scripts/*`（新增） | 两阶段编辑、继承查看、预设和测试结果 |
| `components/variables/*`（新增） | 补全、来源解释、变量抽屉 |
| `KeyValue.tsx` / `ConsolePanel.tsx` | 在现有组件上演进，不重建第二套状态 |
| `services/tauriApi.ts` | 类型化执行/变量/脚本接口和事件适配 |

按功能逐块迁出，维持原操作可用；不先一次性重写 2459 行 App。

### 5.2 脚本存储与兼容

`types.ts` 和 `domain.rs` 增加默认空值的 `scripts`：

```ts
type ScriptSet = {
  preRequest: { code: string; enabled: boolean };
  postResponse: { code: string; enabled: boolean };
};
// RequestSpec、Collection、folder Item 分别持有自己的 ScriptSet。
```

首次读取把 collection.metadata.event、folder/item.metadata.event 和 request 层 event 规范化到所属对象。Postman `listen: prerequest/test` 分别映射到两个阶段；`script.exec` 数组按换行拼接。请求脚本优先读取 item.metadata.event，兼容现有 request.metadata.event 回退，不能重复执行两份。

`postman.rs` 导出按新字段更新所属对象 event，保留未知事件和额外属性；不能只留旧 metadata 导致编辑后导出仍是旧脚本。旧数据通过 serde 默认值继续可读，迁移前留数据库备份；导入→编辑→导出→再导入需保持相同脚本行为。

### 5.3 后端执行编排

新增 `ExecutionPlan` 冻结 request、environmentId、collectionId、脚本继承链和工作区 revision；修改 `lib.rs`/`service.rs`，在 prepare 前进入编排。

顺序：冻结快照 → 集合/外层至内层文件夹/请求的 preRequest → 变量解析及认证 → 构建请求 → 发送与读取响应 → 同顺序 postResponse → 测试结果 → 提交变量变更 → 历史和事件。两个脚本阶段均按集合→文件夹→请求顺序，不能把响应后顺序反转。

临时变量只在 execution 内有效。环境/集合/全局写入先作为 patch 保存在执行上下文：每个成功脚本的写入对后续脚本可见，阶段完成后再按目标 ID 和 revision 事务提交；失败脚本自身 patch 回滚。请求前阶段成功提交后不因网络失败回滚；请求后每个成功脚本可提交，即使断言失败。该提交策略是 LocalPM 首批规则，需要用兼容用例校对 Postman 差异。

并发时同一个变量发生冲突：不整份 saveWorkspace 覆盖，返回 conflict 提示并保留本次执行结果；不同 key 的 patch 可合并。脚本修改 environment ID 不能跟随后续用户切换到另一个环境。

扩展 ExecutionRecord：`phase`、`transportStatus`、`scriptStatus`、`scriptRuns`、`testResults`、`logs`。phase 为 preparing/preRequest/sending/postResponse/finished；transportStatus 和 scriptStatus 分开，HTTP 成功但测试失败仍保留成功响应。

新增 `execution-event`，载荷有 executionId、递增 seq、kind、time、payload；统一发 phase/request-built/response-received/script-log/test-result/execution-finished。前端按 `(executionId, seq)` 去重，旧 request-diagnostic 与 execution-updated 通过兼容适配层接入，防止双份记录。

### 5.4 脚本运行方式

脚本不在 React/WebView 里 `eval`。建议独立 Rust sidecar 承载嵌入式 JS 引擎（QuickJS 为首选候选），宿主通过结构化 IPC 提供有限 pm API，复用现有 Rust HTTP 与密钥策略。引擎选择在开发首个脚本功能前先做 Windows/macOS 技术验证，确认中断、内存限制、JS 语言支持、授权许可和 Tauri sidecar 打包；本设计不指定未验证的 crate 版本。

默认单脚本 3 秒、单阶段累计 10 秒、JS 堆 32 MiB、日志最多 200 条/256 KiB；作为初始可调上限。取消或超时由宿主中止工作进程，主窗口继续可用，之后的新请求能重新创建运行器。响应体仅在大小允许时传入运行器；超限调用 json/text 给出明确错误，禁止解析截断 JSON 后产生假结果。

运行器不暴露文件系统、Tauri invoke、系统命令或任意网络。后续 pm.sendRequest 也必须走宿主同一 HTTP 引擎、限额和取消链路。JS 运行器不是完整 Node.js，因此不提供虚假的 require/npm 兼容承诺。

## 6. 实施顺序与交付范围

| 阶段 | 内容 | 交付门槛 |
|---|---|---|
| A：基础阅读/编辑 | 统一编辑器、响应只读交互、主题 token、括号、查找、格式化；标签视图隔离 | 光标/括号用例在两平台、双主题实测通过，随后再推进脚本 |
| B：请求工作台 | 布局对齐、参数表、变量抽屉、发送快照、保存语义、Console 最大化 | A/B 标签切换、并发发送、取消、保存和恢复无错位/丢数据 |
| C：脚本闭环 | 引擎技术验证、数据迁移、两个阶段、核心 pm API、预设、Tests、日志 | 一份有集合/文件夹/请求脚本的样例完成修改请求→提取 token→断言→复用 |
| D：兼容与稳定 | 导入导出、MCP 同流程、大响应、输入法、系统缩放、回归 | 对齐样例和验收矩阵通过，再决定 pm.sendRequest/Runner 等下一轮范围 |

每阶段独立 PR；App 拆分与对应行为一起提交，避免出现只有重构、没有可验收收益的大改。所有阶段以当前用户数据可升级为前提。

## 7. 验收矩阵

| 编号 | 实际操作 | 必须观察到的结果 |
|---|---|---|
| E01 | 请求 JSON 点击、键盘左右移动；响应点击后移动 | 两区都有可见光标；响应无法改字；Tab 可进入和离开 |
| E02 | 在 `{}`、`[]` 左右移动；输入不配对括号 | 双主题均可识别成对高亮，未匹配括号有不同提示 |
| E03 | 输入中文、组合输入未结束时切换焦点/使用快捷键 | 无重复字、丢字；全局快捷键不抢输入法组合键 |
| E04 | 查找重复字段、跳到下一项、折叠再展开、复制选区 | 位置/计数准确；内容不改变；折叠状态与所在标签对应 |
| E05 | 格式化合法和非法 JSON，再 Undo | 合法结果可撤销；非法保持原文并显示错误位置 |
| E06 | A 看 Headers，B 看 Pretty；来回切换 | 两个请求各自恢复格式、搜索、光标和滚动，不共享错误状态 |
| E07 | 在参数中放重复 key、中文、空值和变量，URL 含 fragment | 列表/URL 不丢信息；后端 echo 验证收到的编码和顺序 |
| E08 | 环境/集合/全局定义同名变量，再加临时变量 | 来源与最终值符合优先级，Secret 显示和诊断脱敏 |
| E09 | A 慢请求运行中切到 B，修改环境和草稿；取消 A | A 使用发送快照；B 不出现 A 结果；取消独立可见 |
| E10 | 编辑已有请求，Send、关闭、重启，再显式 Save | 集合不被 Send 隐式覆盖；草稿可恢复；Save 后 dirty 正确清除 |
| E11 | 集合/两层文件夹/请求的两个阶段分别打印日志 | 顺序符合规则，日志带作用域、阶段、executionId |
| E12 | 前置脚本生成 header；后置提取 token；下一请求引用 token | echo 收到新 header；token 正确更新目标环境；环境切换不写错对象 |
| E13 | 同时放通过断言、失败断言和 JS 异常 | HTTP 响应保留；Test Results 分类正确，点击能定位代码 |
| E14 | 无限循环脚本、超限日志、取消、随后再发正常请求 | 主窗口可操作；执行被中止；下一请求正常；日志有限制提示 |
| E15 | 脚本导入→编辑→导出→再导入 | 两个阶段与继承范围不丢失、不重复执行；未知字段保留 |
| E16 | 请求失败后点“查看诊断”，再最大化和恢复 Console | 定位当前执行；实际构建内容明确；恢复原尺寸，不挤死主区 |
| E17 | 1/5/20 MiB、非法 JSON、二进制、空响应 | 正确回退，说明截断/格式化状态；保存原始文件完整 |
| E18 | 两个执行修改同一环境变量，手动编辑环境同时发生 | 不整份覆盖工作区；冲突有反馈，执行结果仍可阅读 |

自动化：现有 Rust/SQLite 测试桥扩充发送快照、变量 patch、脚本顺序/超时和持久恢复；Playwright 验证焦点、只读、括号 DOM、状态切换和真实复制行为。原生人工验收：Windows WebView2 + macOS WKWebView，浅色/深色，900×640 与常用大窗口，125%/150% 缩放。光标和选区必须看得到，不能仅凭 DOM 存在就判通过。

## 8. 首个开发任务

首先交付阶段 A：提取统一 CodeEditor，修正响应 `readOnly/editable` 配置，统一光标/括号主题，保留每个请求的编辑器状态，并补 E01–E06。该任务不依赖脚本引擎，可直接验证用户已经指出的问题。

随后按阶段 B/C/D 推进。完整外观对照图需在阶段 B 前冻结；脚本兼容清单和运行器验证结果需在阶段 C 前冻结，避免边实现边扩大“完全一致”的范围。

## 9. 参考依据

- 代码基线：[main 提交](https://github.com/mingtaocao/localpm/tree/2c35024525af4b2550db28247a491fc5651ea1f9)。主要依据 `src/App.tsx`、`src/style.css`、`src/types.ts`、`src/components/ConsolePanel.tsx`、`src/components/KeyValue.tsx`、`src/stores/*`、`src/services/tauriApi.ts`、`src-tauri/src/{lib,service,http,domain,variables,postman}.rs` 与现有测试。
- [CodeMirror 核心扩展](https://codemirror.net/docs/extensions/)：editable 与 readOnly 职责不同；光标、选区和括号匹配应作为独立配置验收。
- [CodeMirror API](https://codemirror.net/docs/ref/)：bracketMatching、drawSelection、EditorState.readOnly 等接口。
- [Postman 脚本与执行顺序](https://learning.postman.com/docs/tests-and-scripts/write-scripts/intro-to-scripts/)：两个阶段、集合/文件夹/请求继承顺序及日志。
- [Postman 测试脚本与预设](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/)：Scripts 与 Snippets 的操作结构。

文档中的尺寸、资源限额、保存规则与兼容分期是建议设计，不代表 Postman 的全部实现参数，也不代表当前 LocalPM 已实现。
