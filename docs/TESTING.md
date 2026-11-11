# 验收与正式测试条件

## 已执行的本地验收

2026-11-11，macOS arm64，Node.js **24.22.1**，TypeScript **7.0.2**，
官方 MCP SDK **1.32.2**，使用锁定依赖。
TypeScript 严格编译通过；`npm test` **27 / 27 通过**。

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
本地 `.env` 及所有默认配置保持关闭路由和付费。
本机 3000 已有其他服务，CLI 启动/Smoke 通过临时环境覆盖使用 `127.0.0.1:43123`；未停止或修改原服务。
如本机仍有冲突，可同时覆盖 `PORT` 与 `PUBLIC_URL`，两者保持一致；Smoke 使用相同覆盖值。

Docker 镜像、Compose、Caddy/TLS、云主机、真实 IdP 和用户 ChatGPT/Plus/iOS 端到端均未验收。
没有创建收费资源，没有调用 DeepSeek models/balance 或推理接口；模型 ID 以官方文档确认。

## 正式测试所需条件

- 人工审核 PR；单独确认公网部署目标、域名/证书、网络暴露和任何主机/IdP 费用。
- 已有符合文档的 OAuth 2.1 IdP、owner subject、正确 audience/scope/回调，能验证刷新流程。
- 用户 ChatGPT 网页版账号有实际自定义 MCP 入口；先完成 OAuth 和 **Mock** 当前对话回传。
- 单独同意一次真实推理及金额，例如**最多预留 $0.005、输出最多 128 Token**。
- 用户通过环境/密钥管理器提供有效 DeepSeek Key 与可用余额；先重新核验官方模型和峰值价格。
- 操作者在获准后才设置 live 及两个开关，并先 dry-run；同一 UUID 不重试，保留预算账本。
- 完成后核对供应商用量/账单、关闭两个开关并回读；若测 iOS，另在实际设备验证，不由网页结果推断。

预计用量与费用、估算局限和异常账本处理见 [COSTS.md](COSTS.md)；没有付费测试授权时停留在 Mock。
