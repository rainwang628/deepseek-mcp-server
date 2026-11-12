# DeepSeek MCP Server 工作规则

> 文件版本：V1.2｜更新日期：2026-11-12
> 最近更新：同步当前规则基线与 GPT／DS 的主体工作分工。[来源与边界](#来源与边界)

## 来源与边界

规则来源为私有仓库 [rainwang628/agent-rules](https://github.com/rainwang628/agent-rules)，
本次审阅基线为提交 `05d9ace5f5aa41a13a3b7de28a8ea01baf56425b`；相较最初的 `30ea62b`，
已同步 DS Flash、工作分工、用量回执、iOS 提示及 macOS 项目分类等现行规则：

- [通用规则](https://github.com/rainwang628/agent-rules/blob/05d9ace5f5aa41a13a3b7de28a8ea01baf56425b/AGENTS.common.md)
- [macOS 规则](https://github.com/rainwang628/agent-rules/blob/05d9ace5f5aa41a13a3b7de28a8ea01baf56425b/AGENTS.macos.md)
- [规则仓库维护说明](https://github.com/rainwang628/agent-rules/blob/05d9ace5f5aa41a13a3b7de28a8ea01baf56425b/AGENTS.md)仅约束那个仓库的维护，不把其直推 main 流程应用到本项目。

本项目不复制或修改规则仓库，不加载规则为可执行代码。更新规则基线前重新核验正式正文，说明漂移。
Mac 工作开始前还应读取 `~/rain/agents.md`。Git 交付遵循下方[提交与合并](#提交与合并)。

默认 `ROUTING_ENABLED=false`、`ALLOW_PAID_REQUESTS=false`。不自动推断 Plus 额度，不把 Plus 订阅当作 OpenAI API 额度。
适合的主体工作优先实际交给 DS，使用运营者明确指定且官方可用的模型 ID；GPT 制定框架、验收标准并审核，宿主执行必要工具操作，重要决策仍由当前主模型负责。
未经后续明确授权，不发起真实推理、不部署公网、不开通收费服务、不修改 Mac/iPhone/DSH/Fish Pocket 模型配置。
所有自动测试使用 Mock，并拒绝非回环 fetch。不要给测试注入真实密钥。

修改后运行 `npm test`；凭据、`.env`、数据库和日志不可提交。维护代码和文档都在本仓库内完成。

## 提交与合并

在用户授权的任务范围内，常规改动由 agent 自主完成检查、提交、推送和合并，无须用户逐项确认、阅读代码或手工合并。需要 PR 时，也由 agent 完成创建、核验和合并。

仅当改动较大时，在提交前向用户确认是否提交。按实际影响判断，例如大规模重构、跨多个模块的实质性调整或明显改变现有行为；确认时用清楚的文字说明改动范围、影响和验证结果。不得拆成多个小 commit 绕过确认。同一已授权范围的后续提交、推送和合并不重复确认；任务范围扩大时重新判断。

用户当次明确要求、仓库保护规则和宿主实际权限优先。
