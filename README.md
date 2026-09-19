# Local Postman

本地 HTTP API 调试桌面应用。React + TypeScript 负责编辑，Tauri 2 调用 Rust/reqwest 发送请求，SQLite 保存工作区。无需账号、云同步或外部 API 服务。

**交付状态：部分完成，不能视为通过 ACCEPTANCE.md。** 本机 macOS 验证与构建结果、Windows/CI 外部限制详见 [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md)。

## 功能

- HTTP/HTTPS、自定义 Method、双向同步 Query、可禁用 Headers/Params。
- JSON/Text/XML/HTML/JavaScript raw、URL Encoded、Multipart 文本/流式文件、Binary。
- Bearer、Basic、API Key、Request → Folder → Collection 认证继承。
- Global / Collection / Environment 变量、递归解析、循环/未定义变量报错、作用域预览。
- OS Keychain / Credential Manager 存储标记为 Secret 的变量和代理密码；SQLite 保存引用。Secret 值编辑完离开输入框后写入凭据库。
- Off / System / Manual HTTP(S) Proxy、认证、通配 No Proxy、请求/环境/全局覆盖。
- Cookie jar、TLS 校验警告、自定义 CA、重定向、超时与取消、复用连接池。
- Collection/Folder/Request 创建、重命名、复制、删除、拖放、树虚拟列表和搜索。
- 多标签、500ms Draft、已有请求 2s 自动保存、History、每日 SQLite 备份（最近 7 份）。
- Postman Collection v2.1 / Environment 导入导出；保留未知字段、禁用行和 Scripts；V1 不执行 Scripts。
- 响应 Pretty/Raw/沙箱 HTML Preview、Headers/Cookies、复制/筛选和 Save as；超过 20MB 的响应只保存文件，不向 UI 传递全文。

## 开发

依赖 Node.js 24、稳定版 Rust。macOS 需要 Xcode Command Line Tools；Windows 需要 MSVC C++ build tools 和 WebView2 Runtime。

```sh
npm ci
npm run tauri dev
```

初始开发主机把 Rust 安装在 `/tmp`。如系统 PATH 没有 Cargo，可使用 `scripts/rust.sh npm run tauri dev`；该脚本会优先采用系统已安装的工具链，临时目录不属于项目的运行依赖。

## 验证

```sh
npm run lint
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

HTTP、代理及 HTTPS 测试只监听 `127.0.0.1` 随机端口。TLS 测试文件位于 `testdata/tls/`，是公开的、仅供 localhost 测试的自签名证书及私钥，绝不能用于真实服务。普通测试跳过交互式 OS 凭据库测试，可在本机独立执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test keychain -- --ignored
```

真实 Rust/SQLite 界面回归（需要 Google Chrome）：

```sh
cargo build --manifest-path src-tauri/Cargo.toml --example test_bridge
npm run test:e2e
```

`test_bridge` 是独立测试程序，不包含在安装包内。Playwright 使用浏览器 UI 和实际 Rust HTTP/SQLite，通过测试专用 stdio 适配器连接；文件选择对话框由测试替换。此测试不等同于原生平台安装验收。原生 macOS 验收另外执行。

交互式本地服务：

```sh
node scripts/mock-server.mjs
```

API: `http://127.0.0.1:47831/echo`；HTTP Proxy: `http://127.0.0.1:47832`。其他路由：`/delay`、`/redirect`、`/cookie`、`/upload`、`/download`、`/status/418`、`/gzip`。

## 原生安装包

在对应平台执行，不交叉编译 Windows：

```sh
# Apple Silicon macOS, ad-hoc signed
npm run tauri build -- --bundles dmg
# Windows, unsigned NSIS
npm run tauri build -- --bundles nsis
```

生成目录：`src-tauri/target/release/bundle/dmg/` 或 `src-tauri/target/release/bundle/nsis/`。

`.github/workflows/ci.yml` 在 Windows/macOS 原生 Runner 上检查、测试并打包；`release.yml` 响应 tag 或手动运行，仅上传安装包为 Actions artifact，不发布正式 Release。当前工作区未配置远程 Git 仓库，工作流尚未在线执行。

## 数据与安全边界

- macOS：`~/Library/Application Support/LocalPostman/`。
- Windows：`%APPDATA%/LocalPostman/`。
- 可用 `LOCAL_POSTMAN_DATA_DIR` 指向隔离验收目录。
- SQLite 启用 WAL / foreign_keys，通过 migration 管理结构；完整工作区事务保存。
- `backups/` 保存每日备份；`temp/` 是完整响应文件，可能含用户 API 返回的敏感信息。不要把运行数据目录加入版本控制。
- Secret 变量导出为空值；导入时无法可靠推断敏感性质的值按普通变量保存，由用户标记 Secret。标记 Secret 不会删除此前已经生成的备份中的普通值。
- History 保存发送时请求副本和最多 64KB 的脱敏响应预览；已知 Authorization、Cookie、代理密码和 Secret 变量会脱敏。普通 Body 中未标记为 Secret 的业务数据仍可能被保存。
- Preview 中的 HTML 使用无脚本沙箱；外部响应不会作为应用代码执行。
- 正式 Apple 签名/公证和 Windows 签名需要用户证书；当前开发安装包使用 ad-hoc / unsigned 方式。

详细设计、执行规范和最终验收依据分别见 `LOCAL_POSTMAN_DESIGN.md`、`AI_EXECUTION.md` 和 `ACCEPTANCE.md`，三份原始文档保持不变。
