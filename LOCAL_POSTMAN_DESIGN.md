# Local Postman 详细设计

## 1. 产品定位

目标不是完整复制 Postman，而是实现一个：

> 轻量、纯本地、启动快、无需登录、支持代理、兼容 Postman 数据的 HTTP API 调试工具。

核心使用场景：

```text
开发人员
   ↓
打开 Local Postman
   ↓
选择环境
   ↓
输入 / 打开已有请求
   ↓
处理 {{变量}}
   ↓
通过指定代理
   ↓
发送 HTTP / HTTPS 请求
   ↓
查看 Response
   ↓
请求自动保存到本地
```

第一阶段只聚焦 HTTP/HTTPS。

明确暂不做：

```text
团队协作
云同步
账号系统
Mock Server
Monitor
AI
插件市场
WebSocket
gRPC
GraphQL 专用客户端
Collection Runner
复杂自动化测试
完整 Postman Script Sandbox
```

---

## 2. 技术选型

推荐：

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2 |
| UI | React |
| 语言 | TypeScript |
| 构建 | Vite |
| UI 状态 | Zustand |
| 编辑器 | CodeMirror 6 |
| 后端 | Rust |
| HTTP | reqwest |
| 异步运行时 | Tokio |
| 数据库 | SQLite |
| SQLite Rust 库 | rusqlite |
| JSON | serde / serde_json |
| UUID | uuid |
| 时间 | chrono |
| 密钥 | OS Keychain |
| Windows 打包 | NSIS exe |
| macOS 打包 | dmg |

基本原则：

> React 不直接发送 HTTP 请求，统一通过 Tauri 调用 Rust HTTP Engine。

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 Tauri Desktop                │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │             React Frontend             │  │
│  │                                        │  │
│  │ Collection   Request Editor   History │  │
│  │ Environment  Response Viewer  Settings│  │
│  └──────────────────┬─────────────────────┘  │
│                     │                        │
│                Tauri Command                 │
│                     │                        │
│  ┌──────────────────▼─────────────────────┐  │
│  │              Rust Core                │  │
│  │                                        │  │
│  │ RequestService                         │  │
│  │ VariableService                        │  │
│  │ HttpEngine                             │  │
│  │ ProxyService                           │  │
│  │ CookieService                          │  │
│  │ ImportExportService                    │  │
│  │ StorageService                         │  │
│  └──────────────┬───────────┬─────────────┘  │
│                 │           │                │
│           ┌─────▼───┐ ┌────▼────┐           │
│           │ reqwest │ │ SQLite  │           │
│           └─────┬───┘ └─────────┘           │
└─────────────────┼────────────────────────────┘
                  │
                  ▼
            HTTP / HTTPS API
```

核心链路：

```text
React
 ↓
Tauri invoke
 ↓
Rust
 ↓
reqwest
 ↓
Server
```

---

## 4. 项目目录

```text
local-postman/
│
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   └── router.ts
│   ├── components/
│   │   ├── SplitPane/
│   │   ├── KeyValueEditor/
│   │   ├── JsonEditor/
│   │   ├── Tabs/
│   │   └── VariableInput/
│   ├── features/
│   │   ├── collections/
│   │   ├── request/
│   │   ├── response/
│   │   ├── environments/
│   │   ├── variables/
│   │   ├── history/
│   │   ├── proxy/
│   │   ├── import-export/
│   │   └── settings/
│   ├── stores/
│   ├── services/
│   │   └── tauriApi.ts
│   └── types/
│
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── domain/
│   │   ├── services/
│   │   ├── http/
│   │   ├── importers/
│   │   ├── exporters/
│   │   ├── storage/
│   │   ├── security/
│   │   ├── errors.rs
│   │   ├── state.rs
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── package.json
└── vite.config.ts
```

---

## 5. UI 总体布局

```text
┌─────────────────────────────────────────────────────────────────┐
│ Local Postman                       Environment: DEV    ⚙       │
├─────────────┬───────────────────────────────────────────────────┤
│ Collections │  GET  https://{{host}}/api/user       [ Send ]   │
│             │                                                   │
│ ▼ User API  │ Params Headers Auth Body Settings                 │
│   GET users │ ───────────────────────────────────────────────   │
│   POST user │                                                   │
│             │ key          value                                │
│ Environments│ id           100                                  │
│             │                                                   │
│ History     ├───────────────────────────────────────────────────┤
│             │ Response                    200 OK  128ms  2.1KB │
│             │                                                   │
│             │ Body   Headers   Cookies                          │
│             │                                                   │
│             │ {                                                 │
│             │    "id": 100,                                    │
│             │    "name": "Tom"                                 │
│             │ }                                                 │
├─────────────┴───────────────────────────────────────────────────┤
│ Console                                                       ▲ │
└─────────────────────────────────────────────────────────────────┘
```

布局：
- 顶部：Tab、Environment、Settings
- 左侧：Collections、Environments、History
- 中间上：Request Editor
- 中间下：Response Viewer
- 底部：Console

Request 与 Response 之间支持拖动调整高度。

---

## 6. Request 设计

支持：
- GET
- POST
- PUT
- PATCH
- DELETE
- HEAD
- OPTIONS
- 自定义 Method

编辑区：
- Params
- Authorization
- Headers
- Body
- Settings

---

## 7. Params

统一 KeyValue Editor：

```text
☑ key          value             description
☑ page         1
☑ pageSize     20
☐ debug        true
```

URL 与 Params 双向同步。

---

## 8. Headers

```text
☑ Content-Type     application/json
☑ Authorization    Bearer {{token}}
☐ X-Debug          true
```

区分：
- 用户 Headers
- 系统自动 Headers

---

## 9. Body

支持：

```text
none
form-data
x-www-form-urlencoded
raw
binary
```

raw 支持：
- Text
- JSON
- XML
- HTML
- JavaScript

变量只在发送前解析，数据库保留原始 `{{token}}`。

---

## 10. Multipart

支持文本与文件字段。

文件由 Rust 直接读取并流式上传，避免前端把大文件全部读入内存。

---

## 11. Authorization

V1：

| 类型 | 支持 |
|---|---|
| No Auth | ✅ |
| Bearer Token | ✅ |
| Basic Auth | ✅ |
| API Key | ✅ |
| Inherit Auth | ✅ |
| OAuth 2 | 后续 |
| Digest | 后续 |
| AWS Signature | 后续 |

不支持的 Auth 类型保留原始数据，导出时不丢失。

---

## 12. Auth 继承

```text
Request
 ↓
Folder
 ↓
Parent Folder
 ↓
Collection
```

找到第一个明确 Auth 配置后停止。

---

## 13. Request 内部模型

```rust
struct RequestSpec {
    id: String,
    name: String,
    method: String,
    url: String,
    params: Vec<KeyValue>,
    headers: Vec<KeyValue>,
    auth: AuthConfig,
    body: BodyConfig,
    settings: RequestSettings,
    description: Option<String>,
    postman_metadata: Option<serde_json::Value>,
}
```

原则：

> 不直接把 Postman JSON 当内部模型。

---

## 14. 请求执行 Pipeline

```text
RequestSpec
     ↓
Snapshot
     ↓
Variable Resolver
     ↓
Auth Resolver
     ↓
Query Builder
     ↓
Header Builder
     ↓
Body Builder
     ↓
Proxy Resolver
     ↓
TLS Config
     ↓
Client Resolver
     ↓
HTTP Send
     ↓
Response Parser
     ↓
History Writer
```

---

## 15. ExecutionContext

```rust
struct ExecutionContext {
    workspace_id: String,
    collection_id: Option<String>,
    environment_id: Option<String>,
    local_variables: HashMap<String, String>,
    network_settings: NetworkSettings,
}
```

---

## 16. 变量系统

支持：

```text
{{host}}
{{token}}
{{userId}}
```

完整优先级：

```text
Local
  ↓
Data
  ↓
Environment
  ↓
Collection
  ↓
Global
```

V1 实现：
- Global
- Collection
- Environment

---

## 17. Global Variables

范围：Workspace。

---

## 18. Collection Variables

只在当前 Collection 内有效。

---

## 19. Environment Variables

支持 DEV / TEST / PROD 等环境快速切换。

---

## 20. Variable Resolver

要求：
- 返回解析后的值
- 返回变量来源
- 返回未解析变量
- 支持 UI Hover 查看 Scope

---

## 21. 变量递归

支持：

```text
domain = example.com
host = https://{{domain}}
url = {{host}}/api
```

最大深度建议 10。

循环引用返回：

```text
VARIABLE_CYCLE
```

---

## 22. 未定义变量

不要自动替换为空字符串。

应展示：

```text
unresolved variable: unknownHost
```

---

## 23. 变量作用位置

解析范围：
- URL
- Query Param
- Headers
- Auth
- Raw Body
- UrlEncoded Body
- FormData Text
- Proxy URL

---

## 24. Secret Variable

UI 默认掩码显示。

---

## 25. Secret 存储

普通值：SQLite。

敏感值：
- macOS：Keychain
- Windows：Credential Manager

SQLite 只存 `secret_ref`。

---

## 26. HTTP Engine

使用 `reqwest::Client`。

不要每次发送请求都新建 Client。

实现 `ClientRegistry`，根据：
- Proxy
- TLS
- Redirect
- Certificate

复用 Client 和连接池。

---

## 27. Request Send 流程

```text
点击 Send
   ↓
生成 requestId
   ↓
读取 Request
   ↓
生成 Snapshot
   ↓
解析 Variables
   ↓
解析 Auth
   ↓
构造 URL
   ↓
构造 Headers
   ↓
构造 Body
   ↓
确定 Proxy
   ↓
获取 HTTP Client
   ↓
发送
   ↓
接收 Response
   ↓
统计耗时/大小
   ↓
写入 History
   ↓
返回 UI
```

---

## 28. Response 模型

包含：
- status
- status text
- headers
- body
- duration
- size
- content type
- redirects

---

## 29. Response 大小保护

默认 Preview 上限建议：20MB。

超过后：
- 流式写入临时文件
- UI 只显示元信息
- 支持 Save As

---

## 30. Response Viewer

支持：
- Pretty
- Raw
- Preview

JSON 自动格式化。

二进制支持保存。

---

## 31. Response Header

支持：
- 搜索
- 单个复制
- 全部复制

---

## 32. 状态显示

```text
200 OK
128 ms
2.31 KB
```

---

## 33. Redirect

支持 Follow Redirect。

默认：
- ON
- 最大 10 次

---

## 34. Timeout

全局默认：

```text
30000 ms
```

Request 可覆盖。

---

## 35. 请求取消

Send 后按钮切换为 Cancel。

取消返回统一错误：

```text
REQUEST_CANCELLED
```

---

## 36. Proxy

支持：

```text
Off
System
Manual
```

Manual：

```text
Protocol: HTTP / HTTPS
Host: 127.0.0.1
Port: 7890
Username: optional
Password: optional
No Proxy:
localhost
127.0.0.1
*.company.com
```

---

## 37. Proxy 层级

```text
Request Proxy
      ↓
Environment Proxy
      ↓
Global Proxy
```

每层支持：
- Inherit
- Off
- Manual
- System

---

## 38. Proxy Authentication

代理密码存 OS Secret Store。

---

## 39. No Proxy

支持：
- localhost
- 127.0.0.1
- 192.168.*
- *.company.com
- api.internal.com

---

## 40. SOCKS5

V1 后置。

后续支持：
- SOCKS5
- SOCKS5H

---

## 41. TLS / SSL

默认开启证书验证。

关闭时必须显示明显警告。

---

## 42. 企业内部 CA

支持导入自定义 CA，例如：

```text
company-ca.pem
```

---

## 43. Client Certificate

后续支持 mTLS：
- PFX/P12
- PEM Cert
- Private Key
- Password

---

## 44. TLS Backend

预留：

```rust
enum TlsBackend {
    Default,
    Native,
    Rustls,
}
```

---

## 45. Cookies

CookieService 管理：
- domain
- path
- secure
- httpOnly
- expires
- sameSite

---

## 46. Cookie 覆盖规则

如果用户显式填写 Cookie Header，优先使用用户 Header。

---

## 47. Collection

支持：
- Collection
- Folder
- Request
- 创建
- 删除
- 重命名
- 拖拽
- Duplicate

---

## 48. Collection Tree

统一模型：

```sql
collection_items

id
collection_id
parent_id
type
name
sort_order
created_at
updated_at
```

---

## 49. SQLite 核心表

```text
workspaces
collections
collection_items
requests
environments
variables
history
cookies
settings
drafts
schema_migrations
```

---

## 50. Workspace

默认创建：

```text
My Workspace
```

即使 V1 只支持一个 Workspace，数据库也预留多 Workspace。

---

## 51. Collections

保存：
- workspace
- name
- description
- auth
- metadata
- timestamps

---

## 52. Collection Items

使用 parent_id 构建无限层级树。

sort_order 建议使用 fractional index，避免拖拽导致大量 UPDATE。

---

## 53. Requests

Request 建议整体使用 JSON 文档存储：

```sql
CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE,
    request_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

理由：
- Request 天然为文档结构
- 字段变化快
- Postman 格式复杂
- 降低 Schema 迁移成本

---

## 54. Variables

核心字段：
- scope_type
- scope_id
- key
- value
- secret_ref
- enabled
- is_secret
- sort_order

scope：
- GLOBAL
- COLLECTION
- ENVIRONMENT

---

## 55. Environment

保存：
- name
- variables
- network settings
- proxy override
- timeout override

---

## 56. History

保存的是发送时 Snapshot，而不是单纯引用当前 Request。

原因：

> Request 后续可能修改，History 必须保留当时真实发送的信息。

---

## 57. History 清理策略

默认最多 1000 条。

可配置：
- 100
- 500
- 1000
- 5000
- Unlimited

Response Body 仅保存有限 Preview，例如 64KB。

---

## 58. Draft

编辑时 500ms debounce 保存 Draft。

正式保存后清理 Draft。

应用异常退出后可恢复。

---

## 59. SQLite 设置

启动时：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

数据库结构统一通过 migration 管理。

---

## 60. Postman Import / Export

V1：

Import：
- Postman Collection v2.1
- Postman Environment

Export：
- Postman Collection v2.1
- Postman Environment

后续：
- Postman v3
- Bruno
- OpenAPI
- cURL
- Insomnia

---

## 61. Import 架构

```text
Postman JSON
      ↓
PostmanV21Parser
      ↓
Intermediate Model
      ↓
Internal Model
      ↓
Repository
      ↓
SQLite
```

---

## 62. Importer 接口

```rust
trait Importer {
    fn can_import(&self, input: &ImportSource) -> bool;

    fn parse(
        &self,
        input: ImportSource
    ) -> Result<ImportResult, ImportError>;
}
```

---

## 63. Postman Collection 映射

```text
Postman                 Local

info.name            → Collection.name
item[]               → collection_items
request.method       → Request.method
request.url          → Request.url
request.header       → Request.headers
request.body         → Request.body
request.auth         → Request.auth
variable             → Collection variables
event                → Scripts
```

---

## 64. Postman Folder

递归转换为 Folder 节点，不限制嵌套层级。

---

## 65. Postman URL

优先保留原始 raw URL。

不要为了规范化重新拼接并覆盖原始 URL，以避免：
- URL Encoding 差异
- 变量丢失
- 特殊字符变化

---

## 66. Disabled Header / Params

Postman 中 disabled=true 映射为 enabled=false。

不能直接删除。

---

## 67. Postman Script

V1：
- 导入 ✅
- 保存 ✅
- 显示 ✅
- 导出 ✅
- 执行 ❌

原则：

> 不执行，不代表删除。

---

## 68. Unsupported Data

未知字段放 Extension / metadata JSON 原样保留。

目标：

> 尽量做到无损 round-trip。

---

## 69. Postman Export

```text
Internal Collection
       ↓
PostmanV21Exporter
       ↓
Postman Collection JSON
```

---

## 70. Import / Export 验收

```text
Postman File A
 ↓ Import
Local Postman
 ↓ Export
Postman File B
 ↓
Postman 官方客户端再次导入
```

验证：
- Method
- URL
- Params
- Headers
- Body
- Folder
- Variables
- Auth
- Scripts

语义一致。

---

## 71. Environment Import

Postman Environment 转为：
- Environment
- Variables

Secret 无法可靠识别时先按普通变量导入，由用户手工标记 Secret。

---

## 72. Request Preview

支持查看最终解析请求：

```text
POST {{host}}/user
Authorization: Bearer {{token}}
```

解析后：

```text
POST https://dev.example.com/user
Authorization: Bearer ••••••••
```

---

## 73. Console

底部 Console 展示：
- 时间
- Method
- URL
- Proxy
- Status
- Duration

所有敏感字段自动脱敏。

---

## 74. Error 体系

统一 ErrorCode，例如：

```text
INVALID_URL
DNS_FAILED
CONNECT_FAILED
CONNECT_TIMEOUT
REQUEST_TIMEOUT
TLS_ERROR
PROXY_CONNECT_FAILED
PROXY_AUTHENTICATION_FAILED
BODY_READ_FAILED
FILE_NOT_FOUND
VARIABLE_CYCLE
REQUEST_CANCELLED
RESPONSE_TOO_LARGE
DATABASE_ERROR
IMPORT_INVALID_FORMAT
IMPORT_UNSUPPORTED_VERSION
```

前端根据 code 展示，不解析错误字符串。

---

## 75. 前后端 IPC

React 统一通过：

```text
src/services/tauriApi.ts
```

封装：
- sendRequest
- saveRequest
- getRequest
- importPostman
- exportCollection
- listEnvironments
- saveSettings

不要到处直接 invoke。

---

## 76. Command 设计

建议：

```text
app_bootstrap
list_collections
get_collection_tree
get_request
save_request
delete_request
move_item
send_request
cancel_request
list_environments
save_environment
delete_environment
get_global_variables
save_variables
get_history
clear_history
import_file
export_collection
get_settings
save_settings
```

Command 只作为边界。

业务逻辑放 Service。

---

## 77. React 状态

拆分：
- workspaceStore
- collectionStore
- requestTabsStore
- environmentStore
- settingsStore

不要做一个超级 Store。

---

## 78. Tab

支持多 Request Tab。

每个 Tab：
- tabId
- requestId
- draft
- dirty
- sending

未保存的新请求 requestId 可以为空。

---

## 79. Autosave

区分：
- Draft autosave
- 正式 Request Save

建议：
- 500ms 保存 Draft
- 2s idle 保存正式 Request

---

## 80. 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + Enter | Send |
| Ctrl/Cmd + S | Save |
| Ctrl/Cmd + N | New Request |
| Ctrl/Cmd + W | Close Tab |
| Ctrl/Cmd + K | Search |
| Ctrl/Cmd + Shift + I | Import |
| Ctrl/Cmd + , | Settings |

---

## 81. Search

V1 搜索：
- Collection
- Folder
- Request Name
- URL

后续：
- Header
- Body

---

## 82. Settings

分类：

```text
General
Network
Proxy
Certificates
Data
Security
About
```

---

## 83. 数据目录

Windows：

```text
%APPDATA%/LocalPostman/
```

macOS：

```text
~/Library/Application Support/LocalPostman/
```

目录：
- local-postman.db
- logs/
- temp/
- exports/

---

## 84. 日志

程序日志必须自动脱敏：

禁止记录：
- Authorization 完整值
- Cookie
- Proxy 密码
- Secret Variable
- Basic Auth Password

---

## 85. Crash 恢复

通过 Draft + clean shutdown 标记实现恢复未保存请求。

---

## 86. 数据备份

建议每日首次启动自动备份 SQLite。

保留最近 7 份。

---

## 87. 安全边界

React WebView 不直接：
- 任意访问文件系统
- 操作 SQLite
- 执行系统命令

全部通过明确 Rust Command。

---

## 88. 外部格式架构

```text
                    ┌─ Postman v2.1
                    ├─ Postman v3
External Formats ───┼─ Bruno
                    ├─ OpenAPI
                    ├─ cURL
                    └─ Insomnia
                          │
                          ▼
                   Internal Model
```

---

## 89. cURL

后续支持：
- Import cURL
- Copy as cURL

属于高价值功能，但优先级低于 Postman Import/Export。

---

## 90. V1 功能范围

| 功能 | V1 |
|---|---|
| GET/POST/PUT/PATCH/DELETE | ✅ |
| Query Params | ✅ |
| Headers | ✅ |
| JSON Body | ✅ |
| Text Body | ✅ |
| Form URL Encoded | ✅ |
| Multipart | ✅ |
| Binary Upload | ✅ |
| Basic Auth | ✅ |
| Bearer | ✅ |
| API Key | ✅ |
| Collection | ✅ |
| Folder | ✅ |
| Environment | ✅ |
| Global Variable | ✅ |
| Collection Variable | ✅ |
| History | ✅ |
| HTTP Proxy | ✅ |
| Proxy Auth | ✅ |
| No Proxy | ✅ |
| SSL Verify | ✅ |
| Cookie | ✅ |
| Postman v2.1 Import | ✅ |
| Postman v2.1 Export | ✅ |
| Postman Environment | ✅ |
| macOS dmg | ✅ |
| Windows exe | ✅ |

---

## 91. V1.1

增加：
- SOCKS5
- CA Certificate
- Client Certificate
- cURL Import
- Copy as cURL
- Response Download
- Search
- Dark Mode

---

## 92. V2

考虑：
- Pre-request Script
- Tests
- Collection Runner
- OAuth2
- OpenAPI Import
- Postman v3
- Bruno Import
- WebSocket
- GraphQL

---

## 93. Script 后置原因

完整兼容 `pm.*` API 等于开始实现 Postman Sandbox。

复杂度涉及：
- JavaScript Runtime
- API compatibility
- async
- 安全隔离
- timeout
- 模块
- 变量 mutation

所以 V1：保存但不执行。

---

## 94. 核心依赖方向

```text
UI
 ↓
Command
 ↓
Application Service
 ↓
Domain
 ↓
Infrastructure
```

Domain 不依赖：
- Tauri
- React
- SQLite
- Postman

---

## 95. 五个核心模块

```text
Request Model
Variable Resolver
HTTP Engine
Storage
Import / Export
```

---

## 96. HTTP Engine 接口

```rust
trait HttpExecutor {
    async fn execute(
        &self,
        request: PreparedRequest
    ) -> Result<HttpResponse, HttpError>;
}
```

HttpExecutor 不感知：
- Collection
- Environment UI
- Postman
- SQLite

---

## 97. PreparedRequest

```rust
struct PreparedRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: PreparedBody,
    timeout: Option<Duration>,
    redirect_policy: RedirectPolicy,
    proxy: ProxyConfig,
    tls: TlsConfig,
}
```

---

## 98. RequestService

负责：

```text
RequestSpec
+
Environment
+
Variables
+
Settings
 ↓
PreparedRequest
```

HTTP Engine 只负责执行 PreparedRequest。

---

## 99. 测试策略

重点自动化测试：
- Variable Resolver
- Postman Converter
- Request Builder
- Proxy Resolver
- Database Migration

---

## 100. Postman Golden Test

准备：

```text
testdata/postman/

basic.json
variables.json
auth.json
folder.json
multipart.json
scripts.json
disabled-items.json
complex.json
```

测试：

```text
Import
 ↓
Internal Model
 ↓
Export
 ↓
Compare semantics
```

---

## 101. Proxy 测试

本地启动：
- Mock HTTP Server
- Local Proxy Server

验证：
- Direct Request
- HTTP Proxy
- Proxy Auth
- No Proxy
- Proxy unavailable

---

## 102. HTTP 测试 Server

本地测试接口：
- /echo
- /delay
- /redirect
- /cookie
- /upload
- /download
- /status/{code}
- /gzip

避免依赖公网服务做 CI。

---

## 103. 性能目标

| 指标 | 目标 |
|---|---:|
| 冷启动 | < 1.5 秒 |
| 页面切换 | < 100ms |
| 打开 Collection | < 200ms |
| 变量解析 | < 10ms |
| 1万条 History 搜索 | < 200ms |
| HTTP UI 额外开销 | < 20ms |
| 常驻内存 | 尽量 < 150MB |

---

## 104. 大 Collection

10000 Request 场景使用 Tree Virtualization。

避免一次渲染全部 DOM。

---

## 105. 大 JSON Response

建议：
- < 5MB：Pretty
- 5~20MB：延迟 Pretty / Raw
- > 20MB：Preview / Download

---

## 106. 安装与升级

Windows：

```text
LocalPostman-x.x.x-setup.exe
```

macOS：

```text
LocalPostman-x.x.x.dmg
```

V1 手动升级。

后续可接 Tauri Updater。

---

## 107. macOS 签名

开发阶段可以不签名。

正式分发：

```text
Developer ID Application
 ↓
Code Sign
 ↓
Notarization
 ↓
DMG
```

---

## 108. 开发顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | Tauri + React 骨架 | App 能启动 |
| 1 | Rust HTTP Engine | GET 成功 |
| 2 | POST / Headers / Body | API 调试可用 |
| 3 | Request UI | 可完整编辑 |
| 4 | SQLite | Request 可保存 |
| 5 | Collection / Folder | 请求可组织 |
| 6 | Variables | Global/Env/Collection 可用 |
| 7 | Proxy | Clash/Charles 可代理 |
| 8 | History/Cookie | 日常使用完整 |
| 9 | Postman Import | 原数据迁入 |
| 10 | Postman Export | 可以迁回 Postman |
| 11 | TLS/证书 | 企业接口可用 |
| 12 | Windows/macOS 打包 | 正式软件 |

---

## 109. 第一个可运行版本

只实现：

```text
Method
URL
Headers
Body
Send
Response
```

链路：

```text
Request Editor
    ↓
send_request
    ↓
reqwest
    ↓
ResponseResult
    ↓
React
```

---

## 110. 第二阶段

加入：
- SQLite
- Collection
- Environment
- Variables

这时已经能自己日常使用。

---

## 111. 第三阶段

加入：
- Proxy
- Cookie
- Postman Import/Export

此时基本具备替代日常 Postman 的能力。

---

## 112. 代码量预估

| 模块 | 预计 |
|---|---:|
| React UI | 6k～10k |
| Rust HTTP Core | 2k～4k |
| SQLite | 1.5k～3k |
| Variables | 500～1k |
| Proxy/TLS | 1k～2k |
| Collection | 2k～3k |
| Import/Export | 2k～4k |
| History/Cookie | 1k～2k |
| Tests | 3k～6k |
| 总计 | 约 20k～35k |

建议 V1 控制在 2～3 万行。

---

## 113. 最容易失控的地方

真正难点：
- 变量优先级
- Proxy 继承
- Cookie
- Redirect
- TLS
- 证书
- 文件上传
- Postman 边界格式
- Import/Export 无损
- 大 Response
- 请求取消

---

## 114. 编码前优先冻结的契约

建议先冻结：
- RequestSpec
- PreparedRequest
- ResponseResult
- VariableContext
- ProxyConfig
- AuthConfig
- Internal Collection Model

---

## 115. 推荐最终架构

```text
                   ┌───────────────┐
                   │ React UI      │
                   └───────┬───────┘
                           │
                     Tauri Commands
                           │
                  ┌────────▼────────┐
                  │ RequestService  │
                  └───────┬─────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
      VariableService  AuthService  ProxyService
             │            │            │
             └────────────┼────────────┘
                          ▼
                   PreparedRequest
                          │
                          ▼
                     HttpEngine
                          │
                       reqwest
                          │
                          ▼
                         API

                   StorageService
                         │
                       SQLite

                ImportExportService
                   ▲           ▲
                   │           │
            Postman v2.1     Future Formats
```

---

## 116. 最终产品边界

第一阶段应该做到：

> 打开快、纯本地、无需登录，能够管理 Collection 和环境变量，能够使用 Global / Collection / Environment Variables，能够配置代理，能够正常处理 JSON / Form / File / Cookie / Auth / TLS，能够导入导出 Postman v2.1。

不要一开始复制 Postman 全部能力。

---

# 核心设计原则

```text
React 负责编辑和展示

Rust 负责真正的 HTTP 能力

SQLite 负责本地数据

Internal Model 负责稳定

Postman 只作为 Import / Export Adapter
```

最关键的一条：

> 永远不要让 Postman 格式成为内部数据模型。

这样后续增加 Bruno、OpenAPI、cURL、Postman v3 时，不需要推翻核心架构。
