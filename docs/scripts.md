# 请求脚本与变量串联

在请求的「更多操作 → Scripts」中选择「请求前」或「响应后」。编辑脚本会自动启用当前请求的脚本；也可以用「执行本请求的脚本」开关暂停运行。导入的 Postman 脚本默认不执行，启用后按集合 → 外层文件夹 → 内层文件夹 → 请求的顺序运行；两个阶段都使用该顺序。集合与文件夹的设置中也可编辑其脚本。

## 从登录响应提取 token

假设请求 A 的响应为 `{"data":{"token":"...","userId":42}}`，在 A 的「响应后」填写：

```javascript
const result = pm.response.json();
if (pm.response.code !== 200 || !result.data?.token) {
  throw new Error("登录失败或响应中缺少 token");
}
pm.globals.set("token", result.data.token);
pm.globals.set("userId", String(result.data.userId));
pm.test("登录成功", () => pm.expect(pm.response.code).to.equal(200));
```

A 显示脚本完成后，在请求 B 的 Bearer Token 中填 `{{token}}`，或 Header 中填 `Authorization: Bearer {{token}}`；URL、Params、Body 同样可引用 `{{userId}}`。需要区分测试/生产账号时，优先使用 `pm.environment.set(...)`。同名变量优先级是临时 > 环境 > 集合 > 全局。

变量在本地持久保存。`pm.variables.set` 是当前执行内的临时变量，不写入工作区。并行发送的 B 使用它发送时的快照；本功能不自动触发 B，也不提供集合 Runner。

## 已支持的接口

- `pm.globals`、`pm.environment`、`pm.collectionVariables`：`get`、`set`、`unset`、`has`、`toObject`。值通过 `String(value)` 转为字符串；对象请自行 `JSON.stringify`。
- `pm.variables`：`get`、`has`、`replaceIn`、`toObject` 按优先级读取；`set`、`unset` 仅操作临时作用域。`replaceIn` 支持已有变量的递归替换，不包含 Postman 动态变量。
- `pm.response`：`code`、`status`、`responseTime`、`responseSize`、`text()`、`json()`；`headers.get/has/all`；`to.have.status(code)`。仅响应后阶段可用；二进制或已截断响应不能用 `text/json`。
- `pm.test(name, fn)` 与基本 `pm.expect`：`equal`、`deep.equal`、`eql`、`include`、`property`、`a/an`、`below`、`ok`、`true/false`，支持 `to/be/have/and` 链。断言失败记录用例，不终止后续同步用例，也不会撤销变量写入。
- `console.log/info/warn/error`；`pm.info.eventName/requestName`；`pm.request` 是只读请求快照，修改请求请使用变量模板。

响应面板和 Console 展示脚本结果、用例及日志。脚本异常显示脚本所属对象和 JavaScript 堆栈行号；请求前异常阻止发送，响应后异常保留 HTTP 响应。每阶段抛异常、超时或取消都会丢弃该阶段的变量修改；请求前阶段已成功提交的修改不因后续 HTTP 失败而撤销。

## 执行和存储边界

每个阶段使用独立 QuickJS 上下文，时限 1 秒、内存 64 MiB、栈 512 KiB；单脚本 256 KiB、每阶段 1000 次变量修改、100 条日志及 100 个用例。没有注入 DOM、Tauri、系统命令、文件访问、网络或模块加载 API。Promise/async 使用会报不支持。

脚本只提交具体变量的变更；后端在工作区写锁内合并最新数据，并增加变量版本。界面收到通知后同步变量；旧版本保存会重载并重放明确的本地变量修改，避免用旧工作区覆盖新 token。环境/集合使用发送时的 ID，中途切换环境不会改变写入目标，目标被删除会明确失败。并发修改同一变量时，后提交的值生效。

已有 Secret 标记保持有效，写入系统凭据库。新建变量默认是普通变量，需要保密的字段请预先建立并标记 Secret。日志和历史会脱敏已有 Secret、已识别的 token 等值；普通业务字段不是自动保密数据。Secret 替换采用新凭据引用，SQLite 保存失败不会改写旧引用的凭据。

MCP 预览执行请求前脚本但不提交变量修改，缓存生成的请求和修改清单；运行时使用该缓存，不重复运行请求前脚本。响应后脚本在同一后端执行。MCP 仅可写已授权请求所属集合及本次指定环境，不允许脚本写工作区全局变量；越界时报错。预览、请求、响应、日志继续遵守已有脱敏和路径隐藏规则。

## 兼容范围

这是采用 Postman 操作逻辑与常用 API 的同步子集，不是完整 Postman Sandbox。暂不支持 `pm.sendRequest`、异步脚本/测试、定时器、外部 npm 包、CryptoJS、完整 Chai、动态变量及 Runner 控制；调用未实现接口会报错。Postman v2.1 导入/导出保留事件字段，编辑后的请求脚本导出到 item-level `event`，不会把 LocalPM 的启用开关写进 Postman request 字段。

验证覆盖 Rust 运行时、真实 HTTP/SQLite 串联与重启、脚本回滚/超时/取消、作用域冻结、MCP 冻结预览、变量版本冲突与界面操作。当前本机为 macOS arm64；Windows 编译和原生 WebView 行为仍需平台 CI/原生验收。
