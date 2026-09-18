# AI 执行规范

## 1. 目标

基于 `LOCAL_POSTMAN_DESIGN.md`，从零完成 Local Postman 的：

```text
项目初始化
→ 功能开发
→ 自动测试
→ 缺陷修复
→ 构建验证
→ Windows 打包
→ macOS 打包
→ 最终验收
```

除必要情况外，不要求用户参与中间开发过程。

---

## 2. 执行原则

AI 应持续自主推进，不因为普通技术选择、编译错误、测试失败而暂停询问用户。

以下情况自行处理：

```text
代码结构调整
依赖安装
普通文件创建/修改
编译错误
lint 错误
测试失败
普通 bug
UI 调整
重构
依赖版本兼容
数据库 migration
测试数据创建
本地开发服务器启动/停止
构建失败后的修复
```

基本循环：

```text
实现
 ↓
编译
 ↓
测试
 ↓
发现问题
 ↓
修复
 ↓
重新验证
```

直到通过。

---

## 3. 只有这些情况询问用户

以下操作必须暂停并确认：

```text
删除用户已有重要文件
覆盖无法恢复的数据
修改系统级关键配置
sudo / 管理员权限的高风险操作
上传用户私有数据
向公网发布正式 Release
购买服务
付费操作
使用真实生产账号
使用生产环境 Token / 密钥
创建或使用正式代码签名证书
Apple Developer / Windows 签名相关凭据
执行不可逆操作
```

除此之外默认自主决策。

---

## 4. 技术决策

以 `LOCAL_POSTMAN_DESIGN.md` 为最高设计依据。

设计文档未明确的普通实现细节，由 AI 根据以下原则自主选择：

```text
简单
稳定
可维护
优先成熟方案
避免过度设计
优先满足 V1
```

不得因为存在多个可行方案而暂停开发询问用户。

---

## 5. 范围控制

优先完成 V1。

不得未经必要性验证主动扩展：

```text
AI 功能
团队协作
云同步
Mock Server
插件系统
完整 Postman Script Runtime
复杂 Runner
WebSocket
gRPC
```

发现未来需求时记录为：

```text
TODO / Future
```

不得阻塞 V1。

---

## 6. 开发过程中必须持续验证

每完成一个核心模块立即运行对应测试。

至少覆盖：

```text
HTTP Request
Headers
Params
Body
Variables
Auth
Proxy
Cookie
Redirect
Timeout
Cancel
SQLite
Collection
Environment
History
Postman Import
Postman Export
```

不能全部开发完成后才第一次测试。

---

## 7. 自动测试

必须包含：

```text
Rust Unit Test
Frontend Unit Test
Integration Test
Postman Import/Export Golden Test
HTTP Mock Server Test
Proxy Test
Database Migration Test
```

优先使用本地 Mock Server，避免自动测试依赖公网。

---

## 8. 最终构建前检查

必须依次完成：

```text
npm install
前端 lint
前端 typecheck
前端 test

cargo fmt --check
cargo clippy
cargo test

生产 build
```

所有阻塞错误必须修复。

---

## 9. 应用级验收

必须实际验证至少以下流程：

```text
创建 Collection
创建 Folder
创建 Request

发送 GET
发送 POST JSON
发送带 Header 请求

使用 {{globalVariable}}
使用 {{collectionVariable}}
使用 {{environmentVariable}}

切换 Environment

配置 HTTP Proxy
验证 No Proxy

查看 History

导入 Postman Collection
执行导入后的 Request
重新导出 Collection

关闭应用
重新启动
确认数据仍然存在
```

---

## 10. Postman 兼容验收

至少准备以下测试数据：

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

测试：

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

核心请求语义必须保持一致。

---

## 11. Windows 构建

最终生成：

```text
.exe 安装包
```

优先：

```text
NSIS
```

必须至少验证：

```text
能够安装
能够启动
能够发送请求
能够保存数据
能够卸载
```

---

## 12. macOS 构建

最终生成：

```text
.dmg
```

至少构建：

```text
Apple Silicon
```

如果发布策略要求，同时构建：

```text
x86_64
```

---

## 13. 跨平台构建

不要依赖一台机器强行交叉编译所有平台。

使用 CI Matrix：

```text
windows-latest
macos-latest
```

各平台在自己的 Runner 上构建原生安装包。

推荐：

```text
GitHub Actions
+
tauri-action
```

---

## 14. macOS 未提供正式证书时

如果没有 Apple Developer 正式签名证书：

```text
仍然完成 macOS Build
```

但明确标记：

```text
Unsigned / Ad-hoc build
```

不得因为没有证书停止整个项目。

正式签名和 Notarization 属于发布阶段。

---

## 15. Windows 未提供签名证书时

仍然生成可安装的：

```text
.exe
```

但标记：

```text
Unsigned build
```

代码签名不得阻塞开发版交付。

---

## 16. CI

建立 GitHub Actions：

```text
push / PR
 ↓
lint
 ↓
test
 ↓
build
```

Release Workflow：

```text
tag
 ↓
Windows Runner
 ├─ build
 └─ exe

macOS Runner
 ├─ build arm64
 └─ dmg
```

如果配置了证书，再执行：

```text
sign
notarize
```

---

## 17. 失败处理原则

发生错误时：

```text
分析原因
 ↓
修复
 ↓
重新执行
```

不得因为以下问题立即停止：

```text
dependency error
compile error
test error
type error
lint error
CI error
普通环境配置问题
```

优先自主解决。

只有明确需要用户资源时才询问。

---

## 18. 最终交付物

必须提供：

```text
源代码
README.md
LOCAL_POSTMAN_DESIGN.md
AI_EXECUTION.md

Windows 安装包
macOS 安装包

测试结果
构建结果
已知限制
```

---

## 19. 最终汇报

完成后只需要重点告诉用户：

### 完成情况

```text
实现了什么
```

### 验证结果

```text
多少测试通过
哪些核心场景已验证
```

### 安装包

```text
Windows: xxx.exe
macOS: xxx.dmg
```

### 未完成项

只列真正未完成或受外部条件限制的项目。

例如：

```text
macOS 正式签名未完成：
原因：未提供 Apple Developer Certificate。
当前 dmg 已成功生成。
```

不要输出冗长开发过程。

---

# 核心执行原则

> 开始前理解设计，之后自主完成实现、验证、修复和打包。

> 普通技术问题自行决策，失败自行修复。

> 用户主要关注开始条件和最终结果，而不是开发过程。

> 只有危险、不可逆、涉及付费、生产资源、账号、证书或私密凭据的操作才需要用户确认。
