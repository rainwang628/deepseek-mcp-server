# ChatGPT 网页版连接步骤与验证边界

核验日期：2026-11-11。依据 [OpenAI 官方自定义 MCP 说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)
和 [认证说明](https://developers.openai.com/plugins/build/auth)。实际入口、账号和工作区权限以用户页面为准。

本机当前采用已连接的账号级 [DeepSeek 助手](https://chatgpt.com/plugins/plugin_asdk_app_6af4292e29948191917b0a1ea39019af)，
通过独立私有 Tunnel 访问 stdio；网页 health_check 和 dry-run 已实测。其他对话选择该插件后使用，
已有窗口可能需要刷新工具目录，详见 [全局接入记录](GLOBAL_ACCESS.md)。下节公网 HTTPS/OAuth 是另一种待部署方式。

## 网页版连接（正式部署获准之后）

1. 先完成 [HTTPS/OAuth 部署](DEPLOYMENT.md)。保持 `ROUTING_ENABLED=false`、`ALLOW_PAID_REQUESTS=false`，
   确认公共资源发现元数据可用、`/mcp` 未授权返回 401。
2. 在网页版进入 **ChatGPT Plugins**，点击加号 → **Add custom MCP server**。
   官方当前文档使用这个入口；若账号界面不同，按实际 Apps/开发者入口核对，不能把桌面 Codex 配置视为网页版已连接。
3. 名称填 DeepSeek MCP；Server URL 填 `https://你的域名/mcp`，连接方式使用远程 URL。
   本地 `127.0.0.1` 地址不能直接被 ChatGPT 云端访问。本次不使用隧道、也不创建公网入口。
4. 认证选 **OAuth**，按已注册的 IdP 选择静态 OAuth client 或其支持的 CIMD/DCR，
   在管理页复制真实 redirect URI 到 IdP allowlist，完成 owner 登录与授权。
   不要选 No authentication，也不要把 DeepSeek Key 填到 OAuth client secret 或对话中。
5. 阅读页面风险提示并由用户完成连接。刷新工具后应只发现 `health_check` 和 `ask_deepseek`。
6. 在当前对话启用该连接，先要求调用 `health_check`：确认路由/付费关闭、模型、预算及模式。
   再对 `ask_deepseek` 传新 UUID、短测试文本和 `dry_run=true`，应仅返回费用估算。
7. 完整 Mock 演练须先由用户明确允许该实例的 Mock 路由，再由操作者启用、重启，指定短任务、
   `max_output_tokens=128`、`max_cost_usd=0.005`、`dry_run=false`。确认 `mode=mock`、`mock_only=true`，
   假答案返回同一对话；之后关闭路由。此步骤本次仅以标准 MCP 客户端在本地完成，未以 ChatGPT 网页实测。
8. 真实 DeepSeek 调用需对应授权和有效 Key/余额。本地标准 MCP 客户端的一次真实小额调用已通过，
   结果见 [TESTING.md](TESTING.md#一次真实-deepseek-调用验收)；不代表这里的 ChatGPT 网页连接已验收。

连接/工具审批、开发者权限和 OAuth 登录由 ChatGPT 与工作区控制；服务无权替用户开启这些权限。
只把明确指定的内容交给 DeepSeek，不自动转发完整聊天、其他连接数据或凭据。
不根据猜测的“五小时 Plus 剩余额度”自动分流，不把调用 DeepSeek 描述成已切换当前 ChatGPT 主模型。

## 验证状态

| 项目 | 本次状态 | 后续验收需要 |
| --- | --- | --- |
| 标准 MCP 客户端 → 本地 Mock | 已通过 | `npm test` 可复现 |
| HTTPS 公网可达、真实 TLS | 未部署/未验证 | 用户确认的目标环境和域名 |
| 真实 IdP 登录、授权码、PKCE、刷新 | 未验证 | 已配 IdP、owner 账号与匹配回调 |
| 用户 Plus 网页版添加/连接及工具调用 | **已验证** | 独立私有 Tunnel；health_check 和 dry-run 成功，网页真实推理未测 |
| 用户 iOS ChatGPT 发现/启用/调用该服务 | **未验证** | 实际 iOS 版本、相同账号/工作区和一次端到端调用 |
| Plus 剩余额度百分比 | **没有读取能力** | 可靠官方接口及授权；本项目没有此接口 |
| 真实 DeepSeek Key、官方模型列表和一次推理 | **本地 MCP 已通过** | 2026-11-11，`deepseek-v4-pro` 返回 `MCP_OK`；后续请求需新授权 |
| DeepSeek 实际账单和账号余额 | 未独立核验/未查询 | 由供应商控制台或正式用量记录核对，不以估算替代账单 |

官方列出的协议/连接方式不能证明某个订阅、设备或工作区已获准使用。
也不能用本机 ChatGPT/Codex 工具可用，替代 Plus 网页/iOS 的真实验收；本次不更改这些客户端的配置。
