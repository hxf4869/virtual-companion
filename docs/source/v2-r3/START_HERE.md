# Virtual Companion V2 完整执行包 · R3

日期：2026-10-27（Asia/Shanghai）  
目标仓库：https://github.com/hxf4869/virtual-companion  
原静态审查基线：baa26f7bd2cf50f23058b030e1bc690a5fb553d4

## 现在可以确定的范围

**ST 主界面 + 多角色长期陪伴 + 复杂酒馆卡 + 三 NPC 严格剧情 + 邮箱 / 飞书通知。** 首版浏览器，旧聊天不迁移，所有聊天保存实施 F2 版本冲突检查，模型按用途独立配置。用户允许彻底重构旧模块，优先查询成熟实现并按质量复用。

当前已确认 1A / 2C / 3C、A1 / B2 / C1 / D2 / E3 / F2 / G2、首版邮箱与飞书、设计规范→Stitch→前端，以及三种模型协议。详情见 [决定记录](DECISIONS.md)。**没有阻塞本包交付的产品待决策项。** 模型、预算、通知凭据及部署参数在真正使用前填写。

本轮只修订需求、架构、任务、验收和样例；**未修改项目代码，未生成实际 Stitch 页面，未启动应用、真实模型、通知或部署。** 静态源码风险与待运行验证保持清楚区分。

## 如何交给 Codex / Claude Code

1. 将整个目录放进目标仓库可读的位置，保留相对结构。
2. 先读本页、[总方案](MASTER_PLAN.md)、[决定记录](DECISIONS.md)、[工作计划](docs/07_work_plan.md)。
3. 要求开始实施时，将 [CODEX_START.md](prompts/CODEX_START.md) 或 [CLAUDE_CODE_START.md](prompts/CLAUDE_CODE_START.md) 的执行部分发给对应 Agent。
4. Agent 核对当前 Git 状态与仓库指令，合并已确认的 V2 范围到原 PRODUCT / ADR / TODO，然后连续推进依赖满足的任务。原审查 SHA 是依据，不要求回退你的新提交。

仅阅读、评审或收到 ZIP 不自动触发项目实施；明确启动提示词就是该会话的实施指令，不需要再问一次“是否开始”。开发阶段的普通修复、依赖选型和文档同步不逐步审批。真实付费、外部消息、生产动作遵循实际会话授权。

## 阅读导航

| 文件 | 用途 |
|---|---|
| [MASTER_PLAN.md](MASTER_PLAN.md) | 产品、架构、阶段及交付范围 |
| [DECISIONS.md](DECISIONS.md) | 已确认选择、工程基线、运行前待配置 |
| [DESIGN.md](DESIGN.md) | 设计规则、页面清单、桌面 / 手机交互、Stitch 设计交接 |
| [现有项目审查](docs/01_existing_audit.md) | 原代码静态问题与可复用能力；允许按质量重构 |
| [复用与许可](docs/02_reuse_and_licenses.md) | 所有参考项目、Stars 快照、源码及复用方式 |
| [架构](docs/03_architecture.md) | 数据权威、保存并发、来源恢复、存储、数据权利、三协议与通知 |
| [酒馆兼容](docs/04_tavern_compatibility.md) | 原生卡、世界书、Helper / EJS / MVU 与实际浏览器 |
| [记忆与陪伴](docs/05_memory_companion.md) | 记忆召回、纠正、遗忘、时间与主动跟进 |
| [剧情运行时](docs/06_story_runtime.md) | 首发必含的三 NPC 认知隔离、规则与最终请求 |
| [工作计划](docs/07_work_plan.md) | P0–P6、W01–W16 的步骤、依赖及完成条件 |
| [验收与运行](docs/08_verification_operations.md) | 适用验收、预算、恢复、性能和通知实际送达 |
| [Agent 工作规则](docs/09_agent_protocol.md) | 先查再开发、设计先行、适度验证、持续接续 |
| [样例入口](fixtures/README.md) | 角色卡、记忆、剧情、生命周期和模型配置样例 |
| [decisions.json](references/decisions.json) | 决定状态的结构化镜像 |
| [upstreams.lock.json](references/upstreams.lock.json) | 固定候选版本，非已验证安装组合 |
| [SOURCES.md](references/SOURCES.md) | 官方文档与固定源码入口 |
| [CHANGELOG.md](CHANGELOG.md) | R3 选择落实与 R2 修订保留情况 |

## 实施顺序

P0 先完成范围与重构盘点、复用记录和设计规范；P1 做真实复杂卡验证、Stitch 桌面 / 手机稿及首批前端。之后依次完成桥接、F2 保存、来源恢复、记忆、主动任务和两个通知渠道；P5 必须完成严格剧情；P6 汇总首版实际体验、保护、性能、恢复和运行说明。

设计稿与复杂卡兼容实验可并行。面向用户的页面实现应依据设计规范和相应 Stitch 稿；不因设计工具暂不可用而停止所有后端独立工作，也不把未生成的设计稿标为完成。

## 开工时必须记住的边界

- 先查本仓库、官方文档和 GitHub。成熟实现符合要求就复用，差模块可以重构；不为潜在未来平台造空壳。
- 一轮前台生成只有一条执行链；ST 管自己的聊天持久化，Go 不并行改 JSONL。
- F2 覆盖全部聊天保存，来源事件漏报可恢复，inbox ACK 不能替代版本保护。
- E3 不迁移旧聊天；旧数据保管、导出和删除仍需交代，不能静默混入新记忆。
- C1 已接受保护变化，但磁盘加密与 Go 字段加密仍需准确区分。
- 三协议分别实现和验证；G2 固定用途绑定，前台切换不悄悄改变后台。
- 邮箱、飞书都须实现；外部渠道成功不等于 ST 已保存、手机已显示或用户已读。
- 预算、密钥等未提供不阻塞合成数据开发；未授权真实调用保持关闭。
- 只维护原仓库一套 TODO。应用验证全部保持真实状态，不把包的校验当运行通过。

材料完整性与校验说明见 [BUNDLE_VALIDATION.md](BUNDLE_VALIDATION.md) 和 [MANIFEST.sha256.json](MANIFEST.sha256.json)。
