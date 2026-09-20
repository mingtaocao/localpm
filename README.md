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

## 主题与语言（V1.1 增量）

Settings / 设置中的“外观”区域支持浅色、深色、跟随系统，以及简体中文、English、跟随系统语言。主题默认跟随系统；系统语言为中文时使用简体中文，其余语言回退 English。选择自动保存到现有 SQLite 工作区 settings，重启后恢复，旧数据库无需迁移。

CSS 使用语义颜色变量和 `data-theme`；CodeMirror 的请求体、响应、搜索与折叠提示随主题及语言切换。i18next 资源集中在 `src/i18n/en-US.json` 和 `zh-CN.json`。变量、请求名称、HTTP Method、Header、JSON 及服务器返回内容保持原样；HTML 响应预览保留服务器的原始样式。系统文件对话框的标题由应用翻译，系统按钮由操作系统决定语言。

新增自动验证覆盖三种主题、系统主题变化、中英文及系统语言切换、旧设置兼容、真实 SQLite 后端重启，以及切换前后请求数据不变。验收记录见 [THEME_I18N_ACCEPTANCE.md](THEME_I18N_ACCEPTANCE.md)。

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

完整命令、本机临时 Cargo 用法及 DMG 失败时的备用封装方法见 [BUILDING.md](BUILDING.md)。

在对应平台执行，不交叉编译 Windows：

```sh
# Apple Silicon macOS, ad-hoc signed
npm run tauri build -- --bundles dmg
# Windows, unsigned NSIS
npm run tauri build -- --bundles nsis
```

生成目录：`src-tauri/target/release/bundle/dmg/` 或 `src-tauri/target/release/bundle/nsis/`。

`.github/workflows/ci.yml` 在 push / PR 时运行 Windows/macOS 检查、测试和编译验证，不生成安装包、不发布。独立的 `release.yml` 只允许手动触发，名称为 **Build and Release**；push 或推送 tag 都不会触发发布工作流。

发布步骤：

1. 将 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本同步，更新对应锁文件并提交、推送。
2. 打开 GitHub → Actions → **Build and Release** → **Run workflow**，选择要发布的分支，填写与项目版本一致且未使用的版本号（当前为 `v0.1.0`）。
3. Windows x64 NSIS 与 macOS Apple Silicon DMG 并行构建；任意平台失败都不会运行发布任务。
4. 两个平台成功后，上传两个安装包至草稿 Release，再自动公开发布。tag 指向本次构建的提交，无需手动创建 tag。

目标仓库为 `git@github.com:mingtaocao/localpm.git`；安装包在该仓库 Releases 页面下载。workflow 使用内置 `GITHUB_TOKEN`，无需额外个人 Token。Windows 为 unsigned，macOS 为 ad-hoc 签名、未公证。版本不匹配或 tag 已存在会提前失败；上传或公开发布失败时可能留下草稿，应先检查并处理该草稿再重试。在线发布结果应以对应工作流运行记录为准。

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
