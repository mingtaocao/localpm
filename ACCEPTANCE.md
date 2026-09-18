# Local Postman 最终验收标准

只有以下条件全部满足，项目才允许标记为完成。

---

## 1. 核心功能

必须验证：

- GET / POST / PUT / PATCH / DELETE 可正常发送
- Params 正常
- Headers 正常
- JSON Body 正常
- Form URL Encoded 正常
- Multipart / File Upload 正常
- Global Variables 正常
- Collection Variables 正常
- Environment Variables 正常
- Bearer Auth 正常
- Basic Auth 正常
- API Key 正常
- Collection 正常
- Folder 正常
- History 正常
- HTTP Proxy 正常
- No Proxy 正常
- Cookie 正常
- Redirect 正常
- Timeout 正常
- Cancel 正常

---

## 2. Postman 兼容

必须验证：

- 能导入 Postman Collection v2.1
- 能导入 Postman Environment
- 导入后的请求能够直接执行
- 能重新导出 Postman Collection v2.1
- 能重新导出 Postman Environment
- Import → Export 后核心语义不丢失

至少验证以下内容：

```text
Method
URL
Params
Headers
Body
Folder
Variables
Auth
Disabled Items
Scripts 原始数据保留
```

---

## 3. 数据可靠性

必须实际验证：

```text
创建 Collection
创建 Folder
创建 Request
保存 Environment
关闭应用
重新启动应用
```

重新启动后：

- Collection 仍然存在
- Folder 仍然存在
- Request 仍然存在
- Environment 仍然存在
- Variables 仍然存在
- History 按设计保留

不能因为应用重启导致用户数据丢失。

---

## 4. Windows 验收

必须生成可安装的 Windows 安装包。

优先格式：

```text
.exe
```

必须实际验证：

- 安装成功
- 应用能够启动
- 能够发送一次真实或本地 Mock HTTP 请求
- 能够保存 Request
- 重启后数据仍然存在
- 能够正常卸载

如果没有正式代码签名证书，可以交付 unsigned build，但必须明确标记。

---

## 5. macOS 验收

必须生成：

```text
.dmg
```

至少支持：

```text
Apple Silicon
```

如果项目要求，再增加：

```text
x86_64
```

必须实际验证：

- dmg 可打开
- App 可安装
- App 可启动
- 能够发送一次真实或本地 Mock HTTP 请求
- 能够保存 Request
- 重启后数据仍然存在

如果没有 Apple Developer 正式签名证书，可以交付 unsigned / ad-hoc build，但必须明确标记。

---

## 6. 自动验证

最终交付前，以下检查必须通过：

### Frontend

```text
lint
typecheck
unit test
production build
```

### Rust

```text
cargo fmt --check
cargo clippy
cargo test
release build
```

### Integration

至少包括：

```text
HTTP Mock Server Test
Proxy Test
Database Migration Test
Postman Import/Export Golden Test
```

---

## 7. CI 验收

CI 至少包含：

```text
Windows Runner
macOS Runner
```

必须验证：

```text
代码检查
自动测试
生产构建
安装包生成
```

最终要求：

```text
Windows CI 成功
macOS CI 成功
```

如果某个平台因证书、账号或外部资源无法完成正式签名，不得伪装为已完成，必须明确标记限制。

---

## 8. Postman Golden Test

至少准备：

```text
basic
folder
variables
headers
params
json-body
form-data
auth
disabled-items
scripts
```

执行：

```text
Postman JSON
 ↓
Import
 ↓
Internal Model
 ↓
Export
 ↓
Postman JSON
```

验证核心语义一致。

---

## 9. 应用级验收流程

必须至少完整走通一次：

```text
创建 Collection
 ↓
创建 Folder
 ↓
创建 Request
 ↓
配置 Environment
 ↓
使用 {{environmentVariable}}
 ↓
配置 Header
 ↓
配置 JSON Body
 ↓
发送请求
 ↓
查看 Response
 ↓
查看 History
 ↓
配置 HTTP Proxy
 ↓
验证 Proxy
 ↓
验证 No Proxy
 ↓
导入 Postman Collection
 ↓
执行导入后的 Request
 ↓
重新导出 Collection
 ↓
关闭应用
 ↓
重新启动
 ↓
确认数据仍然存在
```

---

## 10. 最终交付物

最终必须提供：

```text
源代码
README.md
LOCAL_POSTMAN_DESIGN.md
AI_EXECUTION.md
ACCEPTANCE.md

Windows 安装包
macOS 安装包

测试结果
CI 构建结果
已知限制
```

---

## 11. 完成判定

只有以下三类结果允许：

### 已完成

所有必须验收项全部通过。

### 部分完成

存在未完成项，但核心功能可用。

必须明确列出：

```text
未完成内容
原因
影响范围
```

### 未完成

核心能力、构建或安装验证未通过。

不得仅因为：

```text
代码已写完
测试大部分通过
本机构建成功
```

就标记项目为“已完成”。

---

# 核心原则

> 代码写完不代表完成。

> Build 成功不代表完成。

> 自动测试通过也不代表完成。

> 只有核心功能、数据可靠性、Postman 兼容、Windows/macOS 安装包和应用级验证全部达到要求，才算真正完成。

> 任何未通过项必须明确列入最终结果，不得隐藏或模糊描述。
