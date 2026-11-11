# 验收与正式测试条件

## 已执行的本地验收

2026-11-11，macOS arm64，Node.js **24.22.1**，TypeScript **7.0.2**，
官方 MCP SDK **1.32.2**，使用锁定依赖。
TypeScript 严格编译通过；初始验收 27 项，全局 stdio 增补后 `npm test` **29 / 29 通过**。

| 验收内容 | 结果 |
| --- | --- |
| 实际 HTTP 初始化、协议协商、工具列表及 JSON Schema | 通过，两个工具，拒绝未知参数 |
| health_check 和 dry-run | 通过，上游调用数为 0，路由保持关闭 |
| Mock DeepSeek API → answer/usage/费用/预算 | 通过，仅数字回环地址，无真实 Key Header |
| 默认关闭路由、独立付费开关、live 缺少 Key | 通过，所有情形均在推理前拒绝 |
| 单次字节/Token/费用、日预算、累计预算和次数 | 通过，包含并发预留与 UTC 午夜/重启情形 |
| SQLite 持久状态、重复 UUID、异常超预留暂停 | 通过，多个连接共用同一原子账本 |
| 401/429/503、超时、重定向、无效/超大响应 | 通过，不重试，保留不确定费用 |
| Bearer、OAuth/JWKS、issuer/audience/exp/scope/owner | 通过，OAuth 在本地签名模拟 |
| Host、Origin、JSON/body 大小、日志脱敏 | 通过，日志无测试提示词、回答或凭据 |
| stdio 从其他工作目录启动、工具发现、协议与日志分离 | 通过，子进程同样阻止非回环 fetch |
| stdio 与 HTTP 跨进程共享预算和重复 UUID | 通过，共用相同 SQLite 文件，未绕过次数限制 |

测试固定使用新临时数据库，不继承 `process.env` 的真实凭据。
每个测试进程给 `fetch` 加非回环地址拦截，即使付费开关有回归也不能访问真实推理 API。
测试启动/关闭回环服务器，清理自己创建的临时文件；没有向模型产生 API 费用。
首次在默认沙箱中监听被拒，随后使用已授权的本地端口权限完成集成验收；没有关闭系统沙箱或修改模型配置。

依赖安装时的 npm audit：109 个包，0 个已报告漏洞（仅代表安装当时的漏洞库检查）。
本机复用现有应用附带的 Node；为此项目在忽略的 `.runtime/` 准备 npm，未安装全局软件。

## 复现

```bash
npm ci
npm test
npm run build
npm run init:local
npm start
```

另开同目录终端运行 `npm run smoke`。已有 `.env` 不会被初始化命令覆盖。
CLI Smoke 验证存活、工具发现、health_check 和 dry-run；完整 Mock 推理由自动集成测试验证。
初始 CLI 验收时，本地 `.env` 及代码默认配置保持关闭路由和付费；此后用户明确要求正式启用，
当前本机运行状态和全局配置见 [GLOBAL_ACCESS.md](GLOBAL_ACCESS.md)，代码默认值没有改成开启。
本机 3000 已有其他服务，CLI 启动/Smoke 通过临时环境覆盖使用 `127.0.0.1:43123`；未停止或修改原服务。
如本机仍有冲突，可同时覆盖 `PORT` 与 `PUBLIC_URL`，两者保持一致；Smoke 使用相同覆盖值。

Docker 镜像、Compose、Caddy/TLS、云主机、真实 IdP 和 iOS 均未验收。
用户 Plus 网页版已通过私有 Tunnel 实际调用 health_check 和 dry-run，网页真实推理尚未进行。
没有创建收费资源。上述自动测试未调用真实 DeepSeek；后续一次单独获准的真实调用记录如下。

## 一次真实 DeepSeek 调用验收

用户明确批准合并 PR #1，并进行**一次最多 $0.005** 的真实推理，随后在本项目 `.env` 中提供 Key。
北京时间 **2026-11-11 15:47:27–15:47:28**，使用合并提交 `fed24cf95d5d554e3e2240fffa3a086337c5ad29` 完成：

| 项目 | 实测结果 |
| --- | --- |
| 路径 | 标准 MCP 客户端 → 本地回环 `/mcp` → 官方 DeepSeek HTTPS API → MCP 工具结果 |
| 模型确认 | 先调用官方 `GET /models`，确认存在 `deepseek-v4-pro`，再进行 dry-run |
| 工具发现 | `health_check`、`ask_deepseek` 两个工具 |
| 测试任务 | 非敏感固定文本 `Reply with exactly MCP_OK.`；未发送历史聊天或其他连接数据 |
| 请求数与输出上限 | **1 次真实推理、0 次重试**；`max_tokens=128`，关闭 thinking，不启用其他工具 |
| 授权/账本预算 | 单次、当日、累计均限制为 $0.005，使用独立持久账本和 UUID 防重复 |
| 发请求前预留估算 | $0.00074976 |
| 实际响应 | `MCP_OK`，`finish_reason=stop`，未截断 |
| API 报告用量 | 输入 11、输出 3、缓存命中 0 Token |
| 用量费用估算 | **$0.0000264**，按已核验高峰单价计算，低于预留与授权上限 |
| 账本结果 | 当日调用数 1；未结算预留 0；未触发 safety halt |
| 测试后状态 | 本地测试进程已退出；`.env` 仍为 mock、分流 false、付费 false |

Key、原始本地结果、UUID 防重记录和 SQLite 均留在忽略提交的本地文件中；文档不保存凭据。
原始结果为 `.runtime/live-validation-result.json`，账本为 `data/live-validation.sqlite`。
记录会阻止同一授权的再次派发；本次一次性授权已经使用，不能据此继续调用。
价格来源见 [COSTS.md](COSTS.md)，金额是根据 API 返回用量计算的估算，**供应商实际账单与余额未核验**。
该次真实推理测试没有公网部署，未测试真实 OAuth 登录，也不能单凭它认定网页或 iOS 已接通；
之后独立进行的网页工具验证见下节，iOS 仍未实测。

## 全局入口与网页工具验收

本机 Codex 已增加用户级 `deepseek` stdio MCP，从项目外启动完成工具发现和 health_check。
新增两项回环 Mock 测试覆盖 stdio 协议/日志隔离，以及 stdio 与 HTTP 跨进程共享预算和 UUID 防重复，合计 29 项通过。
独立 Secure MCP Tunnel 的创建与账号插件安装得到用户操作时确认；没有复用或修改钱迹的隧道及业务配置。
官方 managed runtime 和 doctor 均通过检查，插件页显示已连接。
[网页验收对话](https://chatgpt.com/c/6af42a35-a3f0-83ee-a56a-2b343ce157e6) 中实际调用两个工具：

- health_check：live、`deepseek-v4-pro`、分流及付费开启，单次/每日/累计限额为 $0.02 / $0.10 / $1。
- ask_deepseek：明确 `dry_run=true`，输入估算 173、最大输出 128、费用估算 $0.00073524。
- 账本调用数仍为 1、已记账估算 $0.00020724、未结算预留 0，本次安装验收没有新增 DeepSeek 推理调用。

网页真实 DeepSeek 推理、iPhone 实际调用、机器重启及休眠恢复尚未验收。
“账号级可用”与“所有窗口已自动调用”是不同状态；旧窗口需要加载工具目录，按各宿主批准规则使用。

## 正式测试所需条件

- 人工审核 PR；单独确认公网部署目标、域名/证书、网络暴露和任何主机/IdP 费用。
- 已有符合文档的 OAuth 2.1 IdP、owner subject、正确 audience/scope/回调，能验证刷新流程。
- 用户 ChatGPT 网页版账号有实际自定义 MCP 入口；先完成 OAuth 和 **Mock** 当前对话回传。
- 单独同意一次真实推理及金额，例如**最多预留 $0.005、输出最多 128 Token**。
- 用户通过环境/密钥管理器提供有效 DeepSeek Key 与可用余额；先重新核验官方模型和峰值价格。
- 操作者在获准后才设置 live 及两个开关，并先 dry-run；同一 UUID 不重试，保留预算账本。
- 完成后核对供应商用量/账单、关闭两个开关并回读；若测 iOS，另在实际设备验证，不由网页结果推断。

预计用量与费用、估算局限和异常账本处理见 [COSTS.md](COSTS.md)；没有付费测试授权时停留在 Mock。
