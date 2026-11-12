# DeepSeek MCP Server

TypeScript 远程 MCP 服务：`ChatGPT → HTTPS /mcp → DeepSeek API → 当前对话`。
采用官方 MCP SDK 的 **Streamable HTTP** 无会话模式；不依赖 Fish Pocket，也不读取或修改 DeepSeek Harness 配置。

实现已通过 [PR #1](https://github.com/rainwang628/deepseek-mcp-server/pull/1) 合并。
全局入口、来源提示及新预算的扩展代码已由 [PR #2](https://github.com/rainwang628/deepseek-mcp-server/pull/2) 合并。
本地 Mock 及一次单独获准的真实 DeepSeek 推理已验收，结果见 [验收记录](docs/TESTING.md#一次真实-deepseek-调用验收)。
未部署公网 HTTP。后续已按用户明确授权启用 live，并安装账号级“DeepSeek 助手”：
网页通过私有隧道的健康检查和 dry-run 已验证，网页真实推理尚未由开发者实测。
用户于 2026-11-11 确认 iPhone 实时调用已成功；这是用户实测反馈，health_check 本身不验证移动设备。
代码默认分流及付费开关保持关闭；本机当前运行状态与全局接入说明见 [GLOBAL_ACCESS.md](docs/GLOBAL_ACCESS.md)。
规则来源及固定提交见 [AGENTS.md](AGENTS.md)。

## 本地启动（默认不产生模型费用）

需要 Node.js 24 LTS 和 npm。依赖已通过 lockfile 固定；不需要 DeepSeek 或 OpenAI API Key。

```bash
npm ci
npm run build
npm run init:local
npm start
```

另开终端，在同一目录运行：

```bash
npm run smoke
```

`init:local` 以 `0600` 权限创建忽略提交的 `.env`，随机生成本地 Bearer Token，既不打印也不覆盖已有文件。
默认仅监听 `127.0.0.1:3000`；`ROUTING_ENABLED=false`、`ALLOW_PAID_REQUESTS=false`、`DEEPSEEK_MODE=mock`。
Smoke 使用标准 MCP 客户端完成初始化、工具发现、健康检查和 dry-run，**不启用分流**。
`/healthz` 是最小 HTTP 存活检查；它不代表真实 API 可用。

完整 Mock 调用测试：

```bash
npm test
```

测试自行启动独立回环 Mock 和 MCP 服务，验证真实 HTTP 往返；结束后关闭端口并删除测试数据。
仅在测试内使用启用路由的独立配置，不改 `.env` 或任何客户端配置。
如需手动调试 Mock，可用 `npm run mock` 在 `127.0.0.1:4010` 启动假 API；服务实际调用仍需操作者明确设置 `ROUTING_ENABLED=true` 并重启。

## 工具

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `health_check` | `{}` | 返回分流、接口能力、预算、Token 限制及配置状态；不访问 DeepSeek |
| `ask_deepseek` | `request_id`、`prompt` 必填；其余见下例 | 校验、估算、预留预算、调用、结算；失败返回 `isError` 和稳定错误码 |

```json
{
  "request_id": "9ad32095-84ad-4ffd-ab16-b83bc80feb68",
  "prompt": "请概括这段我明确委托的文本。",
  "model": "deepseek-flash",
  "max_output_tokens": 512,
  "max_cost_usd": 0.005,
  "dry_run": true
}
```

还支持可选 `system_prompt`。除公开 schema 中的字段外，其余字段拒绝；工具不能修改配置、注入密钥或启用路由。
每个新任务用新 UUID；不确定上次是否送达时复用原 ID。重复 ID 不会再次推理，服务不保存提示词或回答供重放。
`dry_run=true` 在关闭路由时也可估算，不访问上游、不记预算。真实返回含 `answer`、`usage`、费用估算、截断状态和预算。
工具文本以来源标签开头，结构化结果含 `display_label` 和服务器计算的 `provenance`；
实际 DeepSeek 输出、Mock、估算和错误分别标注；DS 主体工作经 GPT 审核后可标为“DS 起草｜GPT 审核”，详见 [来源提示](docs/GLOBAL_ACCESS.md#回答来源提示)。
DeepSeek 返回的文本是外部数据，不能作为修改路由、索取凭据或执行额外任务的授权。

本 MCP 当前仅接收和返回文字，不直接接收图片、原生生图、执行代码或输出文件。DS 可以返回 PPT 内容和制作代码，
由宿主生成并验收成品；生图由具备该能力的宿主工具完成。能力与试用边界见[全局使用说明](docs/GLOBAL_ACCESS.md#图片与-ppt-试用)。

## 路由与付费开关

| 配置 | 结果 |
| --- | --- |
| `ROUTING_ENABLED=false` | 拒绝推理；健康检查和 dry-run 可用 |
| `ROUTING_ENABLED=true` + `DEEPSEEK_MODE=mock` | 仅请求回环 Mock；不发送真实 API Key |
| `ROUTING_ENABLED=true` + `DEEPSEEK_MODE=live` + `ALLOW_PAID_REQUESTS=false` | 拒绝真实推理 |
| 两开关开启 + live + 有效 Key/价格表/预算 | 允许已获授权的真实任务；一次获准的小额实测已通过，后续调用仍需对应授权 |

服务没有额度探测、自动切换或开关工具。修改环境并重启须由操作者在获授权后完成。
**ChatGPT Plus 订阅不是 OpenAI API 额度；DeepSeek 按自己的 API 账单收费。**

## 安全、成本与部署

本地 Bearer 认证仅用于回环开发；远程 URL 强制 HTTPS + OAuth。生产采用已有 OAuth 2.1 身份提供方，
服务校验签名、issuer、精确 audience、exp、scope 和 owner subject，发布 RFC 9728 资源元数据。
ChatGPT 网页版不能依赖自填 Bearer Header；连接方法见专门文档。

- [环境变量与错误处理](docs/CONFIGURATION.md)
- [本机全局 MCP 与账号级私有插件](docs/GLOBAL_ACCESS.md)
- [HTTPS / OAuth 部署说明](docs/DEPLOYMENT.md)
- [ChatGPT 网页版连接与设备验证状态](docs/CHATGPT.md)
- [价格来源、预计费用与预算机制](docs/COSTS.md)
- [验收结果与正式测试条件](docs/TESTING.md)

`src/` 为实现，`tests/` 为回环集成与安全测试，`scripts/` 为本地初始化/Mock/Smoke，
`deploy/` 和 `Dockerfile` 是待实际环境验证的部署模板。没有自动部署、模型调用或修改规则仓库的后台任务。
