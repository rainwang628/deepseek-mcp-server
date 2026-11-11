# 环境变量与错误处理

所有配置由环境变量提供，`npm start` 可读取项目 `.env`；真实环境可从密钥管理器注入。
不使用 URL、工具参数或代码常量携带 Key。`.env.example` 中凭据必须为空；不要提交实际 `.env`、日志或数据库。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | 默认只绑定回环；非回环绑定只能使用 OAuth |
| `PUBLIC_URL` | `http://127.0.0.1:3000/mcp` | 精确资源 URL，也是 OAuth audience；路径必须 `/mcp`；公网必须 HTTPS |
| `AUTH_MODE` | `bearer` | `bearer` 仅本地；远程用 `oauth` |
| `MCP_BEARER_TOKEN` | 空，Bearer 模式必填 | ≥32 个非空白 ASCII 字符；本地初始化随机生成，不打印 |
| `OAUTH_ISSUER` / `OAUTH_JWKS_URL` | 空，OAuth 模式必填 | 已有 IdP 的精确 issuer 与 JWKS URL，远程必须 HTTPS |
| `OAUTH_ALLOWED_SUBJECTS` | 空，OAuth 模式必填 | 逗号分隔 owner `sub` 白名单，拒绝其他账号 |
| `ALLOWED_HOSTS` | 自动包括 `PUBLIC_URL` 的 host:port | 可追加代理/健康探针使用的精确 Host，逗号分隔；无通配符 |
| `ALLOWED_ORIGINS` | 空 | 默认允许无 Origin 或公共 URL 自身 origin；需要时追加 `https://chatgpt.com` |
| `DEEPSEEK_MODE` | `mock` | `mock` 只访问数字回环 HTTP，`live` 固定官方 HTTPS API |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | 官方文档确认的另一个可选值为 `deepseek-flash` |
| `DEEPSEEK_API_KEY` | 空 | 仅 live 推理需要；不通过 health_check 验证或输出，不发往 Mock |
| `MOCK_DEEPSEEK_URL` | `http://127.0.0.1:4010` | 只接受数字回环 HTTP origin，拒绝域名、路径、查询和凭据 |
| `ROUTING_ENABLED` | `false` | 推理前必须明确开启；只接受字面量 `true` / `false` |
| `ALLOW_PAID_REQUESTS` | `false` | 独立付费授权门；只适用于 live 模式 |
| `MAX_OUTPUT_TOKENS` | `2048` | 服务端单次输出上限；最高可配 20480，仍同时受总 Token 与单次费用限制 |
| `DEFAULT_OUTPUT_TOKENS` | `512` | 未指定 `max_output_tokens` 时使用，不得高于输出上限 |
| `MAX_TOTAL_TOKENS` | `16384` | 保守输入估算 + 最大输出之和上限；不是官方 tokenizer 的精确计数 |
| `MAX_INPUT_BYTES` | `12000` | JSON 编码后的 messages 的 UTF-8 字节上限，涵盖系统/用户文本 |
| `MAX_COST_PER_REQUEST_USD` | `0.02` | 单次预留估算上限；工具 `max_cost_usd` 只能收紧 |
| `DAILY_BUDGET_USD` / `TOTAL_BUDGET_USD` | `1` / `50` | UTC 日和累计估算限额，支持 0 以禁止相应调用；金额按纳美元取整 |
| `MAX_CALLS_PER_DAY` | `200` | 包含失败/不确定请求的每日次数上限，费用限额同时执行 |
| `CHATGPT_IOS_USER_VERIFIED_ON` | 空 | 可选 YYYY-MM-DD；运营者登记用户已实测 iPhone 实时推理的日期，不代表服务自行验证 |
| `CHATGPT_WEB_TOOLS_VERIFIED_ON` | 空 | 可选 YYYY-MM-DD；运营者登记网页 health_check/dry-run 已验证，不据此确认网页真实推理 |
| `REQUEST_TIMEOUT_MS` | `30000` | 整个上游请求及读响应期限；50–120000 ms |
| `MAX_RESPONSE_BYTES` | `1048576` | 响应读取上限，避免异常上游耗尽内存 |
| `MAX_CONCURRENT_REQUESTS` | `2` | 每进程并行 MCP POST 上限，超出 HTTP 429 |
| `LEDGER_PATH` | `data/budget.sqlite` | 持久卷中的 SQLite；`:memory:` 只用于单元测试 |

本机运营配置见 [GLOBAL_ACCESS.md 的分流范围与费用](GLOBAL_ACCESS.md#分流范围与费用)：用户于 2026-11-12
明确授权单次上限 $0.05，以容纳 20480 Token 输出的预留；其他共享预算保持不变。
表中是新实例默认值，不应仅为调整一台已授权服务而修改默认付费开关或重置账本。

OAuth scope 固定 `deepseek:invoke`，支持 RS256 / ES256 / EdDSA。HS256、自签名伪造令牌、过期/缺少 exp、
错误 issuer/audience/scope/subject 均拒绝。只将 `http://127.0.0.1` 或 `[::1]` 视为本地测试例外。
授权服务器的登录、授权码、PKCE 和刷新由已有 IdP 负责，本项目不签发登录凭据。

HTTP：缺少或无效凭据 401，scope 不足 403，Host/Origin 不可信 403，非法 JSON 400，超大 body 413，忙 429。
`GET/DELETE /mcp` 返回 405，因为本实现使用无会话 JSON 响应，不提供长期 SSE 订阅。
MCP 的无效参数返回工具错误；未知工具和协议错误由官方 SDK 处理。
工具结果文本现在有来源标签，应读取标准 `structuredContent` 获取 JSON 数据，不对 `content[0].text` 整体执行 JSON.parse。
`provenance` 由服务器根据执行路径生成；失败时推理状态为 unknown，不能因此认定未发生费用。

业务错误码见 `src/errors.ts`：路由/付费关闭、凭据未配、Token/费用超限、预算耗尽、重复请求、
上游授权/限流/超时/响应无效及账目故障。错误文本不包含上游响应正文、堆栈、请求头或密钥。
上游不自动重试，也不跟随重定向；调用者不能通过 MCP 改上游 URL。

应用日志是 stdout JSON，仅含时间、事件、UUID、工具、模型、模式、耗时、用量、估算金额或固定错误码。
提示词、答案、OAuth Token、DeepSeek Key、请求头、原始 provider error 都不记录。代理/宿主也应禁用 body/header 调试日志。
`startup_failed` 是脱敏启动失败事件；先核对必填变量、端口占用和账本目录权限，不要通过打印整个环境排错。
