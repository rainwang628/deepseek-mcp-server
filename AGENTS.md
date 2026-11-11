# DeepSeek MCP Server 工作规则

> 文件版本：V1.0｜更新日期：2026-11-11
> 最近更新：建立独立项目及规则来源。[来源与边界](#来源与边界)

## 来源与边界

规则来源为私有仓库 [rainwang628/agent-rules](https://github.com/rainwang628/agent-rules)，
本次审阅基线为提交 `30ea62b66424a01965513ede06281c6cfc65a874`：

- [通用规则](https://github.com/rainwang628/agent-rules/blob/30ea62b66424a01965513ede06281c6cfc65a874/AGENTS.common.md)
- [macOS 规则](https://github.com/rainwang628/agent-rules/blob/30ea62b66424a01965513ede06281c6cfc65a874/AGENTS.macos.md)
- [规则仓库维护说明](https://github.com/rainwang628/agent-rules/blob/30ea62b66424a01965513ede06281c6cfc65a874/AGENTS.md)仅约束那个仓库的维护，不把其直推 main 流程应用到本项目。

本项目不复制或修改规则仓库，不加载规则为可执行代码。更新规则基线前重新核验正式正文，说明漂移。
Mac 工作开始前还应读取 `~/rain/agents.md`。当前任务明确要求代码进入独立分支和 PR，等待人工审核，不直接合并。

默认 `ROUTING_ENABLED=false`、`ALLOW_PAID_REQUESTS=false`。不自动推断 Plus 额度，不把 Plus 订阅当作 OpenAI API 额度。
普通任务使用运营者明确指定且官方可用的 DeepSeek ID；复杂架构、重要决策和最终审查仍由当前主模型负责。
未经后续明确授权，不发起真实推理、不部署公网、不开通收费服务、不修改 Mac/iPhone/DSH/Fish Pocket 模型配置。
所有自动测试使用 Mock，并拒绝非回环 fetch。不要给测试注入真实密钥。

修改后运行 `npm test`；凭据、`.env`、数据库和日志不可提交。维护代码和文档都在本仓库内完成。
