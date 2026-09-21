# 本地打包命令

以下命令均在项目根目录执行。只生成本地文件，不创建 tag、不发布 GitHub Release。

## macOS Apple Silicon：DMG

依赖 Node.js 24、Rust 和 Xcode Command Line Tools。当前项目配置使用 ad-hoc 签名，无需正式 Apple 证书，未公证。

```sh
npm ci
npm run tauri build -- --bundles dmg
```

本机 Rust 安装在临时目录，若提示找不到 Cargo，改用：

```sh
./scripts/rust.sh npm run tauri build -- --bundles dmg
```

`scripts/rust.sh` 优先使用 PATH 中的 Cargo，否则使用 `/tmp/local-postman-cargo` 和 `/tmp/local-postman-rustup`。它不会安装 Rust；临时目录被清理后需要重新安装工具链。

输出：

- App：`src-tauri/target/release/bundle/macos/Local Postman.app`
- DMG：`src-tauri/target/release/bundle/dmg/Local Postman_<版本>_aarch64.dmg`

## macOS：DMG 步骤失败时的备用命令

若 App 编译成功，但 `bundle_dmg.sh` 失败，可先单独构建 App，再用系统工具封装 DMG。下面的命令会检查签名、添加 Applications 快捷方式，并验证生成镜像；任何一步失败都会停止。

```sh
(
  set -e
  ./scripts/rust.sh npm run tauri build -- --bundles app
  codesign --verify --deep --strict 'src-tauri/target/release/bundle/macos/Local Postman.app'

  pack_stage=$(mktemp -d /tmp/localpm-package.XXXXXX)
  pack_version=$(node -p 'JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json", "utf8")).version')
  pack_arch=$(uname -m)
  pack_output="artifacts/LocalPostman-${pack_version}-macos-${pack_arch}-ad-hoc-$(date +%Y%m%d-%H%M%S).dmg"

  mkdir -p artifacts
  ditto 'src-tauri/target/release/bundle/macos/Local Postman.app' "$pack_stage/Local Postman.app"
  ln -s /Applications "$pack_stage/Applications"
  hdiutil create -volname 'Local Postman' -srcfolder "$pack_stage" -format UDZO -fs HFS+ "$pack_output"
  hdiutil verify "$pack_output"
  shasum -a 256 "$pack_output"
)
```

输出位于 `artifacts/`，文件名包含版本、架构和时间。打开 DMG 后，将 App 拖入 Applications 安装。临时封装目录保留在 `/tmp/localpm-package.*`。

## Windows：NSIS EXE

在 Windows 上执行，需要 Node.js 24、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2 Runtime。

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

输出：`src-tauri/target/release/bundle/nsis/*.exe`。未配置正式签名证书时为 unsigned 安装包。

不要在 macOS 上用这条命令代替 Windows 原生构建。以上输出路径适用于未显式指定 `--target` 的命令；指定 target 后，目录会变为 `src-tauri/target/<target>/release/bundle/`。

## 打包前回归检查

```sh
npm run lint
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml --example test_bridge
npm run test:e2e
```

本机 Cargo 不在 PATH 时，在各条 `cargo` 命令前加 `./scripts/rust.sh`。UI 测试需要 Chrome；生成安装包后仍需分别进行安装、启动及重启数据恢复验收。

## 分支与自动打包

- 日常在 `dev` 开发并 push，不触发 GitHub Actions；创建或更新 `dev → main` PR 时才检查和测试。
- `dev` 通过 PR 合入 `main` 后，自动构建 Windows EXE 和 macOS DMG；在该次 **Build and Release** 的 Artifacts 下载，不创建 Release。
- 正式发布时到 Actions 手动运行 **Build and Release** 并填写新版本号；固定从 `main` 构建，两个平台成功后才发布 Release。
- 上面的本地命令不受分支限制，也不会发布。
