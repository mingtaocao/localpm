# Local Postman V1 验收报告

记录日期：2026-09-19。结论：**部分完成**。核心功能及本机 macOS 开发版可用；未达到 `ACCEPTANCE.md` 的全部完成条件。Windows 与在线 CI 环境由用户明确安排后续提供。

## 自动检查

| 检查 | 实际结果 | 证据 |
|---|---|---|
| npm install | 通过 | artifacts/frontend-checks.log |
| ESLint / TypeScript | 通过 | artifacts/frontend-checks.log |
| Frontend unit tests | 6 / 6 通过 | artifacts/frontend-checks.log |
| Frontend production build | 通过 | artifacts/frontend-checks.log |
| cargo fmt --check | 通过 | artifacts/rust-checks.log |
| cargo clippy --all-targets -D warnings | 通过 | artifacts/rust-checks.log |
| Rust tests | 35 通过，1 个交互式凭据库测试在默认套件中跳过 | artifacts/rust-checks.log |
| macOS OS credential store | 被默认跳过的测试已独立运行并通过；测试条目随后删除 | `cargo test --test keychain -- --ignored` 的本次工具执行结果 |
| Playwright UI regression | 3 / 3 通过 | artifacts/ui-checks.log、ui-test-results.json |
| macOS Rust release / Tauri DMG | 通过 | artifacts/macos-build.log |

Rust 35 项由 13 项单元测试、12 项 Golden/导出回归、8 项 HTTP/代理集成、1 项完整持久化/备份恢复、1 项 TLS 集成组成。TLS 测试分别验证默认拒绝测试自签名证书、关闭校验后成功、导入自定义 CA 后成功。

网络测试覆盖 GET/POST/PUT/PATCH/DELETE/OPTIONS/自定义 Method、Query/Header、JSON、URL Encoded、Multipart、Binary、Global/Collection/Environment 优先级、环境切换、Basic/Bearer/API Key、Folder Auth 继承、代理/认证/No Proxy/故障、Cookie/显式 Cookie 优先、Redirect、Timeout、Cancel、21MB 响应落盘。

Golden 数据包含 basic、folder、variables、headers、params、json-body、form-data、auth、disabled-items、scripts。逐字段检查原始语义保留，并验证编辑 Auth 后正确导出，以及内部 none/inherit 不导出为无效 Postman 模式。

## 应用级验证

### 浏览器 UI + 真实 Rust/SQLite

完整流程通过：创建 Collection → Folder → Request → GET → DEV 环境变量 → 自定义 Header → JSON POST → History → Manual HTTP Proxy → No Proxy → 导入 Postman → 执行导入请求 → 导出 → 退出 Rust 后端 → 新进程启动 → 恢复 Collection、Folder、Request、Environment、Variables、History → 再次发送成功。

另外通过 Secret 输入完整值在失焦后提交的回归，以及 10,000 Request 时 DOM 限定为 50 行以内、搜索命中最后一条请求的回归。

此测试使用真实核心库和 SQLite，但通过独立 stdio 测试适配器替代 Tauri IPC、使用测试文件对话框；不将其冒充平台安装验收。截图：`artifacts/ui-workflow.png`、`artifacts/ui-restart.png`。

### 最终 macOS DMG 原生应用

已对最终 DMG 执行以下实际操作：

- 只读挂载 DMG，CRC 校验通过。
- 从挂载映像复制 `.app` 到 `/tmp/local-postman-final-installed/`，完成拖放式安装等价验证。
- `codesign --verify --deep --strict` 通过；签名方式为 ad-hoc。
- 启动最终 App，使用 `/tmp/local-postman-final-data/` 隔离数据库。
- 创建 `Final Acceptance` Collection、`Final Folder`、保存 `Final GET` 请求。
- Collection 变量 `path=/echo`、Environment `Final DEV` 变量 `host=http://127.0.0.1:47831` 正常解析。
- GET 与 JSON POST 均返回 200；POST 返回值包含 `native-final`。
- 原生 UI 配置 Manual Proxy `http://127.0.0.1:47832`，响应确认含 `x-via-local-proxy:true`。
- No Proxy 配置 `127.0.0.*` 后响应不再包含代理标记。
- 通过 macOS 系统文件选择器导入 `basic.json`，执行导入的 GET 请求返回 200。
- 通过 macOS 保存对话框导出 Collection；已读取导出 JSON 检查名称、Method、URL。结果保存在 `artifacts/native-postman-export.json`。
- 正常退出应用，通过同一独立数据目录重新启动；Collection、Folder、Request、环境及变量保留。
- 重启后再次 POST 返回 200，History 显示此前 5 次请求和重启后第 6 次请求。

这覆盖 macOS 安装包要求的挂载、安装、启动、请求、保存和重启持久化验证。

## 安装包

- **macOS Apple Silicon**：`artifacts/LocalPostman-0.1.0-macos-arm64-ad-hoc.dmg`
- SHA-256：`8beabef7cff3fe86cef2c0567d944d8ef442f53603effc8c394c2e8d3f0b9e0e`
- 原始构建路径：`src-tauri/target/release/bundle/dmg/Local Postman_0.1.0_aarch64.dmg`
- **Windows .exe：未生成**。不存在可交付的 Windows 安装包，不以配置文件代替成果。

## 未完成 / 外部限制

1. **Windows 原生构建与安装/启动/请求/保存/重启/卸载验收未执行**：没有 Windows 主机或 Runner。用户已说明后续提供环境；影响 Windows 交付。NSIS 配置及待执行验收步骤已提供。
2. **Windows CI / macOS CI 成功记录未取得**：本报告初次验收时尚未提供远程仓库。随后用户指定 `mingtaocao/localpm` 作为目标仓库；两份 GitHub Actions 工作流已创建，在线运行结果仍需单独验证，不能据此标记 CI 通过。
3. **正式签名及公证未执行**：没有使用生产证书或开发者账号。macOS 已提供 ad-hoc 开发版；不影响当前开发版构建。
4. **Postman 官方客户端重新导入的人工兼容检查未执行**：当前已完成内部 Golden 原始语义、导入请求执行与原生导出验证，但不宣称官方客户端实测通过。
5. 系统代理读取已启用原生能力，但没有更改用户系统网络设置进行端到端系统代理测试；Manual Proxy / No Proxy / Proxy Auth 已通过本地测试。
6. 设计中的冷启动、常驻内存等全部性能指标尚未进行正式基准测试；仅验证了 10,000 Request 的虚拟列表与搜索行为。

上述限制未解除前，本项目必须保持“部分完成”，不能宣布全部完成。
