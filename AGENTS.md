# 项目默认规则

## UI 与样式

- UI 修改遵循 [docs/UI-STYLE-GUIDE.md](docs/UI-STYLE-GUIDE.md)，复用 `src/styles/tokens.css` 的字体、间距与尺寸变量；更新组件已有规则，并检查中英文、浅深主题和最小窗口截图。

## 新功能提交与版本号

- 提交新功能时，必须在同一功能交付中升级应用版本号，并将版本文件与功能代码一起提交。
- 默认遵循语义化版本：新功能升级 minor 并将 patch 归零；修复升级 patch；不兼容变更根据影响升级 major。用户指定版本号时优先按用户要求执行。
- 一次功能交付只升级一次版本号；同一功能的后续修正不重复升级。如果版本号遗漏，追加版本提交，不擅自改写已有提交。
- `package.json` 是唯一版本来源。使用 `npm version minor --no-git-tag-version`（或指定版本）调用已有同步脚本，不逐个手工修改版本文件，不自动创建 tag 或发布 Release。
- 提交前执行 `npm run version:check` 和 `npm run test:version`，确保 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 一致；Tauri 配置继续引用 `../package.json`。

更多开发与验收约定见 `AI_EXECUTION.md`；版本操作说明见 `README.md` 的“版本管理”。
