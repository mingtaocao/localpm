# Windows 原生验收记录模板（尚未执行）

不得将工作流文件存在或 macOS 构建成功当作 Windows 验收通过。

1. 在 Windows Runner / Windows 10 或 11 主机执行 `.github/workflows/ci.yml` 同等检查，保存日志。
2. 使用 MSVC + WebView2 构建 `npm run tauri build -- --bundles nsis`，记录 `.exe` 文件名、SHA-256。
3. 在非管理员的测试账户运行安装包，确认安装成功。
4. 启动安装后的 Local Postman，执行 `node scripts/mock-server.mjs`。
5. UI 创建 Collection → Folder → Request，GET `http://127.0.0.1:47831/echo`，确认 200。
6. 保存 Request 和 DEV 环境变量；关闭并重新打开应用，确认数据、变量及 History 保留。
7. 通过 Windows 已安装应用界面卸载，确认程序卸载成功；不要删除用户真实数据。
8. 在验收报告记录系统版本、安装目录、日志/截图和通过/失败项。

正式签名不属于开发版的阻塞条件；当前配置生成 unsigned NSIS 安装包。此文档是待执行步骤，不是成功证据。
