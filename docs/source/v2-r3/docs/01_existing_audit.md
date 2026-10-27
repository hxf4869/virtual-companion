# 现有 virtual-companion 静态审查与重构处置 · R3

核验日期：2026-10-27。main 基线：baa26f7bd2cf50f23058b030e1bc690a5fb553d4，2026-10-26 提交。当前主项目 Apache-2.0。以下是静态源码事实，不是线上运行结论；执行开始时先核对当前 HEAD 的相关差异。

## 1. 现有栈已经是 Go

backend/cmd/companiond 启动 Go 服务；前端为 Vue 3 / uni-app H5；PostgreSQL + pgvector。已有模型协议适配、流式 / 恢复、持久任务、账户、关系、消息、记忆管理和导出。

- [入口](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/cmd/companiond/main.go)
- [Go module](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/go.mod)
- [Provider factory](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/provider/factory.go)

因此不再安排“从其他语言迁移到 Go”。技术方向沿用原生 ST Node 宿主、Go 长期服务与 PostgreSQL。用户已经允许对现有项目模块彻底重构：先检查现有实现和成熟开源方案，按质量决定保留、整理、替换或删除；既有模块并不因为已经存在就必须继续保留。暂不安排无实测依据的全量 Rust 重写。

## 2. 当前长期召回缺乏按问题相关性

正式 LoadSeed 路径：

1. seedWindow 为64。
2. SelectRecallMemories 参数包括 owner、relationship、conversation、scope，不包括当前问题或检索向量。
3. V132 SQL 过滤有效来源后按 created_at、id 升序取候选。
4. Go 对每条候选写 Relevance:50。
5. builder 稳定排序、过滤无效 / 空条目后最多保留20条，再受上下文预算裁剪。

当有效非空条目足够多时，早期记忆容易长期占位。近期聊天可能暂时覆盖新信息，但长期召回不会因本轮问题相关而优先新记忆。不能因为装了 pgvector 就宣称生产语义检索已接通。

- [LoadSeed / SelectRecallMemories](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/generation.go)
- [V132 SQL](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V132__recall_effective_memory.sql)
- [builder](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/turn/builder.go)

处理：维持来源可追溯、作用域隔离、纠正与删除的产品要求；具体表、查询和模块可以重构。正式召回必须被 ST 新入口实际使用，不保留仅为旧前台继续工作的第二条召回链。

## 3. 提取较窄，摘要入口未接到正常加载

memory_extract.go 为真实后台任务，具备幂等和重试。当前主要从本轮用户原文抽取 FACT / PREFERENCE，最多3项，并做来源连续片段校验。它不能承担所有共同经历、承诺、角色关系和剧情事件。

ContextSeed 和 builder 支持 Summary，但实际 LoadSeed 没有赋值 seed.Summary。需接入真正的摘要来源，并确保编辑 / 分支变更后摘要失效，不只增加一个永远未调用的摘要接口。

- [提取器](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/memory_extract.go)
- [ContextSeed](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/turn/seed.go)

保留明确事实证据的优点。新增事件记忆需区分用户陈述、模型台词、虚构经历、真正执行成功的动作，不能把 assistant 输出全当事实。

## 4. 单角色是产品和数据库约束

PRODUCT.md 指定唯一默认陪伴者，登录后自动创建，不进入角色创建 / 选择。V9 的 relationship_one_active_per_owner partial unique index 限制每个 owner 一个 active 关系；创建 / 激活流程会关闭其他 active。已有多个历史关系可以保留。

- [产品范围](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/PRODUCT.md)
- [V9](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V9__relationship_active_companion_limit.sql)
- [默认关系逻辑](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V122__recent_conversations_default_relationship.sql)

处理：拆分 UI 当前选择、角色启用和会话参与者，允许同时保有多个角色实例。按实际现有数据选择增量 schema 变更或隔离的 V2 数据域；保留必要账号标识和数据权利映射，不把旧关系和旧来源记忆无条件转成 V2 有效内容。E3 已确认不迁移旧聊天；重构授权不包含清库。约束修改须覆盖实际 SQL、应用逻辑和前端调用，不能只改列表页面。

## 5. 人设和主动程度只是当前回复设置

现有 prompt 有固定倾听风格；persona 主要是名字、称呼、回复长度、幽默、建议和主动程度。主动程度高只会在当前回复中更主动，不产生离线任务。

scheduler 执行清理、导出和任务恢复。当前工作类型包括 GENERATION、DATA_EXPORT、MEMORY_EXTRACT；没有完成的主动问候领域闭环。

- [persona](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/turn/persona.go)
- [scheduler](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/scheduler.go)
- [jobs loop](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/loop.go)

处理：前台采用 ST 角色卡体系；旧 persona 的可用设计作为偏好设置参考，不设强制历史迁移任务。后台实现有限跟进、inbox，以及用户已选择的邮箱和飞书通知。先评估已有持久任务机制，缺陷实现可以替换；没有实际需求不引入另一套消息中间件。

## 6. 现有 Go 执行器是 bounded chat turn

ModelRequest 主要是文本角色消息，当前执行链不具备完整 tool call / tool result 结构。已有失败重试和供应商回退，不等于工具 Agent。

- [模型结构](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/companion/provider.go)
- [coordinator](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/turn/coordinator.go)

新架构前台由 ST 管生成和已有工具链。Go provider 可用于明确的后台提取 / 问候任务；只有实际后台 Agent 缺口才接 Pi。不要把同一输入送进两个执行器。

## 7. 性能与扩容边界

源码默认 MaxConcurrentTurns=1，允许配置且校验上限16；不代表实际部署未覆盖。generation plane 使用 vc.runtime.singleton advisory lock，完整运行实例不是直接可水平复制的多 worker 架构；实时 hub 也有进程内状态。

- [config](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/config/config.go)
- [lease](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/lease.go)
- [现有采样报告](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/docs/planning/g12-go-capacity-sample.md)

旧报告包含 fake provider 的运行时测试，不能背书真实模型的首字和中文记忆体验。私人服务首版保留单实例；要扩容时再根据实测改执行归属，不用 Rust 重写代替架构分析。

## 8. 重构处置表

| 资产 | 处置 |
|---|---|
| Go 数据库、关系、记忆生命周期、任务 | 按实际质量复用或重构；保留需求中的能力和数据边界，不强制保留旧分层、接口或表结构 |
| 旧账户和 owner ID | 保留必要的身份和数据归属映射；密码＋TOTP 的既有保护要求继续满足，实现可替换 |
| Go provider、超时、有限重试 | 评估后用于后台 run 或由成熟实现替换；补三协议所需语义，避免重复前台生成链 |
| 旧聊天和导出能力 | E3：不导入 ST、不做续聊迁移或强制历史页面；旧数据原位/归档保留，记录导出、删除责任及取回方式 |
| SSE / 取消 / 恢复思路 | 按实际任务需求参考，删除不再有消费者的旧链路；保留 ST 正常流、取消和恢复行为 |
| Vue / uni-app | A1＋E3：原生 ST 成为主产品，旧界面可退役；首版不要求保留历史/迁移入口或开发微信小程序 |
| 固定 persona / 单角色约束 | 用角色卡、实例及新产品偏好模型替代；删除已被替代且无实际调用的代码 |
| 记忆固定同分、早期截断 | 替换为实际查询召回 |
| Go-only、单角色、无工具及旧前台条款 | V2 ADR 明确覆盖冲突范围，保留历史决策出处；不创建仅为兼容已退役功能的空接口 |

审查没有证明线上效果不佳的全部原因。执行中仍需用固定输入和真实请求验证改动是否改善体验，不以这些静态发现代替真实使用评价。


## 9. 已核验的加密与数据权利能力

固定代码的FieldCipher采用AES-256-GCM，消息与记忆写入实际调用加密；full数据库模式要求密钥/Cipher。这是已存在的应用层保护能力，不是仅有未使用的工具类；本次没有检查部署密钥和全部历史回填。

用户已经明确选择 C1：接受 ST 原生明文数据目录，并落实磁盘、文件权限和备份保护；Go 仍须满足已有字段保护能力。具体旧加密模块可以重构，但不能把磁盘加密当成字段加密的等价替代。保护边界见架构第15节。旧 Go 导出任务只遍历其数据域；既有 durable deletion intent、取消和导出对象清理是可复用参考，不会自动清除 ST 与外部记忆数据。E3 不迁移旧聊天也不取消对现存旧数据的保管、导出和删除责任。

来源：[字段加密](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/fieldcipher.go)、[导出任务](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/export.go)、[删除流程](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/httpapi/account.go)、[持久删除意图](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V103__durable_account_deletion_intent.sql)。

上述是静态能力与跨域设计缺口，不是本轮已经复现了数据泄露、数据丢失或删号故障。

## 10. 已授权重构的执行边界

允许在未来明确启动实施后替换质量差的模块、调整目录/包职责、删除重复生成路径和停用入口。先写清本次实际需要的行为，再查看本仓库和官方/GitHub 现成实现；研究记录只保留决定所需的信息，不无限选型。

保留的是本版确定的能力：可信身份、密码与 TOTP、必要数据保护、来源与删除语义、流式取消、可靠任务和所有聊天保存的 F2 版本检查。没有继续使用者的旧 API 不要求永远兼容；需要切换的调用方在同一工作项内调整，不长期堆两套实现。

旧聊天不迁移，不代表可以删除旧数据、未提交工作或历史分支。E3 的遗留数据清单要有明确保管位置和导出/删除路径；从旧聊天派生的记忆默认不进入新 ST 上下文，只有在来源和作用域重新核验后才能作为单独的明确数据接入。当前仍只修订执行包，不开始代码重构。
