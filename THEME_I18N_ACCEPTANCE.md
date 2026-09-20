# 主题与多语言增量验收

记录日期：2026-09-20。本次实现不改变 HTTP、SQLite 或 Postman 核心架构；不代表原始 `ACCEPTANCE.md` 的双平台验收已全部完成。

## 实现

- Light / Dark / System，默认 System；监听系统颜色变化。
- zh-CN / en-US / 跟随系统语言，默认跟随系统；非中文系统回退 English。
- SQLite 工作区 settings 保存选择，兼容没有新字段的旧数据。
- 全局语义 CSS 变量覆盖页面、侧边栏、表单、面板、通知及交互状态；请求体与响应 CodeMirror 切换主题。
- i18next 中英文资源集中管理界面、提示、错误、文件对话框标题和 CodeMirror 搜索/折叠文案。
- 用户数据和 HTTP 内容不翻译。服务器 HTML 预览保留原始内容与样式；系统原生对话框按钮语言由操作系统决定。

## 已执行验证

- ESLint、TypeScript、前端 production build：通过。
- Vitest：10/10 通过（原有 6 项，新增 4 项）。
- Playwright：6/6 通过（原有 3 项，新增 3 项）。新增覆盖主题切换和系统变化、中英文和系统语言变化、未知系统语言回退、真实 Rust/SQLite 后端进程重启持久化、编辑器实际配色、中文搜索面板，以及切换前后请求数据一致。
- cargo fmt、clippy --all-targets -D warnings：通过。
- Rust：默认套件 35 项通过；默认忽略的系统凭据库测试另行执行，1 项通过。
- macOS arm64 release 构建、ad-hoc 签名：通过。`codesign --verify --deep --strict` 通过。
- 浅色英文、深色中文的设置及请求/响应截图已实际检查，位于 `artifacts/theme-*.png`。

## 本地安装包

Tauri 的 App 构建成功，但其 `bundle_dmg.sh` 步骤失败。改用系统 `hdiutil` 将已签名 App 与 Applications 快捷方式封装为压缩 DMG：

`artifacts/LocalPostman-0.1.0-theme-i18n-macos-arm64-ad-hoc.dmg`

这是当前源码的本地开发包，未使用正式证书、未公证。没有创建 tag 或发布 GitHub Release。

## 尚未验证

- Windows 原生界面及安装包：本机为 macOS；新增 UI 测试纳入现有 Windows/macOS CI，但私有仓库 CI 运行结果未能读取，不能宣称 Windows 验收通过。
- 本次新增功能在安装后的原生 WebView 中完整交互与重启检查尚未完成。已通过的重启检查是浏览器 UI 连接真实 Rust/SQLite 测试进程。
