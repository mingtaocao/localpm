# 实现结构

- `src/App.tsx`：桌面工作区、请求标签、编辑器、响应与设置面板。
- `src/components/`：KeyValue、Auth、Network、虚拟 CollectionTree。
- `src/stores/workspace.ts`：独立工作区 Zustand 状态和串行持久化队列；请求标签为组件状态。
- `src/services/tauriApi.ts`：唯一 Tauri IPC / 文件对话框适配层；UI 不发送 API HTTP 请求。
- `src-tauri/src/domain.rs`：独立 RequestSpec / Workspace / Response / Error 模型。
- `variables.rs`：环境 > Collection > Global、递归解析、循环检测、脱敏。
- `http.rs`：请求准备、认证继承、代理分层、ClientRegistry、流式文件、Cookie、取消/超时与 TLS。
- `postman.rs`：v2.1/Environment 与内部模型之间的转换、未知字段保留。
- `storage.rs`：事务、SQLite migration、Draft/History、Cookie 和在线备份。
- `security.rs`：History/响应预览凭据过滤。
- `lib.rs`：Tauri commands、OS credential store 边界和应用启动。

工作区文档作为恢复原始结构的完整快照保存在 `workspaces`；Collection / Item / Request / Environment 同时写入专用表，保持事务一致。变量和设置目前嵌入工作区 JSON；对应数据库表预留。History、Draft、Cookie 独立存储。

自动测试不依赖公网 HTTP 服务。浏览器回归使用 `examples/test_bridge.rs` 作为测试进程，调用真实核心库，但不替代操作系统安装、原生 IPC 或凭据库验收。
