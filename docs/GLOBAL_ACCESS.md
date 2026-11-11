# 全局使用与私有账号插件

本服务可以同时提供本机 Codex 全局 stdio 入口和 ChatGPT 账号级私有插件入口。
两者复用同一个实现、`.env` 及 SQLite 账本；不是为每个窗口复制一份预算。
默认配置仍然关闭分流和付费，启用状态由操作者在本项目 `.env` 明确设置。

## 本机 Codex 全局入口

本机已将 `deepseek` 注册到用户级 `~/.codex/config.toml`，命令只含 Node、环境文件和 stdio 入口的路径，
没有复制 DeepSeek Key 或本地 Bearer Token。变更前的配置备份在忽略提交的 `.runtime/config-backups/`。
原来的主模型、其他 MCP 和 DSH 配置保持原样。

接入其他机器时，在项目构建完成后使用官方 CLI；按实际位置替换路径：

```bash
codex mcp add deepseek -- /absolute/path/node \
  --env-file=/absolute/path/deepseek-mcp-server/.env \
  /absolute/path/deepseek-mcp-server/dist/src/stdio.js
codex mcp get deepseek --json
```

服务启动时会回到项目根目录，从其他工作目录启动也使用同一账本。
MCP stdout 只输出协议消息；脱敏运行日志走 stderr。
Codex 新会话可加载用户级 MCP。已有窗口若工具目录尚未刷新，在设置的 MCP servers 中重启该服务，
或开启新会话后通过 `/mcp` 核对。配置写入和标准客户端验收不等于每个已打开窗口都已加载成功。
本机已按实际全局配置从项目外启动，并通过工具发现和 health_check；没有因此额外发起付费推理。

## ChatGPT 账号级私有插件

参照本机“钱迹账单助手”，采用 **独立 OpenAI Secure MCP Tunnel → stdio MCP**。
不复用钱迹的隧道、账单工具、数据库或配置；DeepSeek 有自己的 tunnel/profile/runtime alias。
OpenAI 的个人组织与 ChatGPT 工作区关联控制隧道访问，私有 stdio 不额外运行公网 OAuth 或无鉴权公网 HTTP。
HTTP 接口原有的 Bearer/OAuth 认证要求不变。

2026-11-11，独立隧道已创建并关联当前个人 Platform 组织和 ChatGPT 工作区；官方托管 runtime 的
`process_running`、`healthy`、`ready` 均为 true，doctor 检查通过。
[DeepSeek 助手](https://chatgpt.com/plugins/plugin_asdk_app_6af4292e29948191917b0a1ea39019af)
已安装并连接到本人 ChatGPT 账号，与“钱迹账单助手”分别列在 Installed 中。
[网页验收对话](https://chatgpt.com/c/6af42a35-a3f0-83ee-a56a-2b343ce157e6)
实际调用了 health_check 和 `dry_run=true` 的 ask_deepseek，返回当前 live 配置、模型和共享预算。
dry-run 返回输入估算 173、最大输出 128、费用估算 $0.00073524；账本仍为调用数 1、金额 $0.00020724、未结算预留 0。
因此本次安装与网页验收没有新增 DeepSeek 推理费用。
网页真实推理和 iPhone 实际调用尚未进行；之前真实 DeepSeek 推理成功的记录来自本地标准 MCP 客户端。

本机隧道客户端和 Bun 从已留存的官方安装包独立提取到本项目 `.runtime/`，提取前校验原安装包 SHA-256。
来源和校验记录保存在本机 `.runtime/verified-runtimes.json`，原安装包仍留在 `~/rain/softs/`。
`macos/secure_tunnel.mjs` 从 macOS 钥匙串按私有元数据指定的条目加载受限 OpenAI 运行密钥，
只注入隧道子进程的环境；profile 使用 `env:CONTROL_PLANE_API_KEY` 引用，不保存密钥正文。
管理脚本只输出状态摘要，不回显 vendor 日志尾部；隧道环境不转发 DeepSeek Key 或 MCP Bearer Token。
本项目私有元数据、profile 和自身隧道日志已进行实际凭据匹配检查，没有发现密钥正文。
复用现有运行密钥时不改原条目和权限；其续期会影响使用该条目的所有隧道。

安装人员在忽略提交的 `.private/tunnel-settings.json` 填写 tunnel ID、Keychain service/name 和 Node 路径，
然后使用项目内的管理命令：

```bash
./start-tunnel.command
.runtime/bun/bun macos/secure_tunnel.mjs doctor
.runtime/bun/bun macos/secure_tunnel.mjs status
./stop-tunnel.command
```

启动采用官方 `tunnel-client runtimes connect` 的本机进程监督；必须看到 runtime 状态运行、healthy、ready 后才报告就绪。
不是通过 nohup 或公开端口维持隧道。Mac 仍须开机、联网和保持唤醒；重启/休眠恢复不能在未实测时声称可靠。

插件创建并安装到本人 ChatGPT 账号后，在其他对话选择“DeepSeek 助手”；已有会话刷新工具目录。
工具应只有 `health_check` 与 `ask_deepseek`。首次核对状态和 dry-run，不发送私有历史或凭据。
手机需在同一账号和工作区实际调用，结果未观察前保留“未验证”状态。

## 分流范围与费用

“全局可用”表示其他会话能够加载并选择同一服务，不表示后台强制替换所有窗口的主模型。
主模型负责调度；普通任务在用户选择本服务或明确委托后可交给 DeepSeek，重要架构、决策和最终审查仍保留在主模型。
服务初始化会报告当前路由、付费授权和共享费用上限，不能根据猜测的 Plus 额度自行开启。
宿主的工具批准规则继续适用；MCP 不会恢复或绕过宿主额度。

本机已明确启用 live，模型 `deepseek-v4-pro`，上限为单次 $0.02、UTC 每日 $0.10、累计 $1。
所有入口共享限额和 UUID 防重复；金额为应用侧估算保护，局限见 [COSTS.md](COSTS.md)。
关闭时在 `.env` 设 `ROUTING_ENABLED=false`、`ALLOW_PAID_REQUESTS=false`，重启/刷新所有使用中的 MCP 进程并回读 health_check。
不要删除账本或新建不同文件绕过限制。

## 官方依据

- [Codex MCP 配置与会话加载](https://learn.chatgpt.com/docs/extend/mcp)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [ChatGPT 自定义 MCP 插件](https://developers.openai.com/api/docs/guides/custom-mcp-server)
