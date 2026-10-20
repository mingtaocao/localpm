# 脚本与两请求传参

在请求配置中打开 **Scripts / 脚本**，选择 **Post-response / 响应后**，勾选“执行此请求的脚本”。导入的 Postman 脚本默认关闭，确认内容后再启用。

例如请求 A 的响应是 `{"data":{"token":"abc"}}`，先选择 DEV 环境，在 A 的响应后脚本填写：

```javascript
const data = pm.response.json();
pm.environment.set("token", data.data.token);
```

先发送 A，等“脚本结果”显示变量更新，再发送请求 B。B 可在 URL、参数、请求头或请求体中引用 `{{token}}`，例如：

```http
Authorization: Bearer {{token}}
```

字段路径按实际响应修改。缺失或 null 字段会明确报错，不会写入字符串 `undefined`。脚本失败时保留 HTTP 响应和旧变量，修正后重新发送 A。

## 支持范围

- 请求前、响应后脚本；集合→外层至内层文件夹→请求顺序。
- `pm.environment`、`pm.collectionVariables`、`pm.globals`：`get/set/unset/has/toObject`。环境和集合写入需要对应目标存在。
- `pm.variables`：`get/set/unset/has/toObject/replaceIn`。这里的 set 仅对当前请求执行有效，跨请求请用环境或集合变量。
- `pm.response`：`code/status/responseTime`、`json()/text()`、`headers.get()`、`to.have.status()`。
- `pm.request.url.update()` / URL 赋值、`pm.request.headers.get/upsert/add/remove()`、raw body 修改。
- 同步 `pm.test`，基础断言 `equal/deep.equal/include/property/a/an/below/true/false/null/undefined`；`console.log/info/warn/error`。未支持的断言明确报错。
- 请求脚本可编辑、保存、恢复、导出；Postman 未知事件保留。集合及文件夹导入脚本需通过集合的继承脚本开关启用。

`pm.sendRequest`、异步脚本、Runner、npm 包与完整 Chai 暂未实现。这里的流程是依次手动发送两个已保存的请求。

## 执行与保存

QuickJS 在 Rust 端的独立 VM 内执行，无浏览器、文件、命令和网络宿主接口。每脚本最多 3 秒、VM 堆 32 MiB，支持取消；响应体脚本读取上限 5 MiB。每脚本最多 200 次变量写入，每次值最多 64 KiB。

前置脚本失败会阻止网络发送；前置成功后提交变量。响应后失败仍保留响应；失败脚本自身变量写入回滚，之前成功脚本的写入可提交。断言失败会保留测试结果并继续其他测试。变量按执行开始时的环境/集合 ID 写回，修改同一个变量时返回冲突；无关变量可合并，排队中的旧工作区保存不会覆盖新的脚本值。已标记 Secret 的变量沿用操作系统凭据库。

手动请求与 MCP 复用运行器、变量提交和结果记录。MCP 预览在 VM 中构建请求前脚本结果，不持久化；运行冻结预览时才提交。MCP 只能修改获准执行的集合和所选环境的变量，不能修改全局变量。脚本日志、历史及 MCP 输出沿用脱敏。

验证：真实 HTTP/SQLite 测试覆盖两请求、重启、前置参数/请求头、失败回滚、环境切换、写入冲突、旧保存保护、导出、超时和 MCP；界面测试覆盖中英双语、脚本编辑保存与真实两请求传参。Windows/macOS 安装包仍须由平台 CI 构建验证。
