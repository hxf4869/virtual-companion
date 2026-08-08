---
name: harness-change
description: 修改 Agent 规则、Harness 配置、治理脚本、受保护路径、Skill、任务模板、证据 Schema 或 CI 门禁时使用。
metadata:
  id: harness-change
  version: 1.1.7
  riskClass: C4
---

# Harness Change

## Purpose

在不为当前任务放宽约束的前提下修改治理系统，并证明不同平台和 Agent 客户端仍执行同一套规则。

## Preconditions

- READY 任务明确列出 `harness-change`、精确版本、C4 风险和人工批准；
- Base Commit、Context Fingerprint、读写范围、禁止路径、验收和前向修复策略完整；
- 任务要求独立 Reviewer，且 Harness 变更与业务变更隔离。
- `OWNER-MAINT-20260801-READY-GREENLINE-01` 仅授权 TASK-0072 的精确自举
  boundary 在 READY 前写入本 Skill、Doctor、目标测试和登记的机器真源；它不授权
  第二条记录、可配置白名单、环境变量、CLI flag、历史重写或任何通用 override。
  boundary 必须是 `60b09ec198a0c37b2345576d3cc593bfbe887bd5` 的单父直接子提交，
  且 TASK-0072 进入 Task Ledger 后该入口只能作为不可变历史验证，不能再次放行写入。
- `OWNER-MAINT-20260802-TASK-0073-PRE-READY-01` 仅授权以
  `ee0757a8749a0ccab53553785b92abb865e4373b` 为 Base、在 TASK-0073 普通
  DRAFT 直接子提交之后创建一个单父 pre-READY maintenance commit，精确修复
  task-delivery-policy canonical hash 与 TASK-0072 历史 boundary Doctor
  绑定。它只能修改机器记录冻结的 8 个路径；普通 READY Doctor PASS 后才能
  实现。其他 Task、第二条记录、第二次消费、额外提交/路径、通用 override、
  环境变量、CLI flag、Git note/replace/graft、历史改写和可配置 allowlist
  均未授权。
- `OWNER-MAINT-20260802-TASK-0074-PRE-READY-01` 仅授权以
  `65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94` 为 Base、在 TASK-0074
  DRAFT 的一个直接单父子提交中修改卡片冻结的 11 个路径：精确隔离
  TASK-0073 terminal Commit/Tree 上固定 Evidence/Review Blob/SHA 与
  Reviewer 原生 UNKNOWN 元组；为未来 Evidence/Handoff 登记 TIMEOUT/UNKNOWN
  强类型非 PASS；登记不可重锚的总时长、DRAFT→READY 与 IN_PROGRESS 后候选
  执行两阶段预算；固定 Reviewer 15 分钟上限；登记 TASK-0074 专用 Windows
  canonical/exact-tree 合并门禁且 WSL 仍独立。历史产物、其他 Task、第二条
  记录/消费、额外提交/路径、通用 override 和所有禁止接口均未授权；普通
  READY Doctor 真实 PASS 前不得实施。
- `OWNER-MAINT-20260803-TASK-0075-PRE-READY-01` 仅授权以
  `d41c9f82e69107cf1ecf0cb2c100d39f436faab7` 为 Base、在冻结
  TASK-0075 DRAFT 的一个直接单父子提交中修改精确 11 个路径。该记录必须
  使用 TASK-0073 maintenance 自身 CI-policy Blob 与固定
  `d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd`
  父边自身的历史对象，并只读隔离 TASK-0074 终态 Commit/Tree、5 个
  mode/type/blob/content 制品和完整 10-error tuple。它可以为未来
  `candidateExecution` 增加严格 `NOT_STARTED`，以及强制未来 terminal
  Handoff/project-state `nextAction` 一致，但不得修改 TASK-0073/0074
  历史制品或弱化 PASS/FAIL/TIMEOUT/UNKNOWN。完整 Owner 授权计划与
  “按计划用 goal 继续下去”必须同时绑定；第二条记录、复制、额外路径、
  通配写路径、当前 Policy 重判历史、通用 override 或任何禁止接口均未授权。
- `OWNER-MAINT-20260804-TASK-0076-PRE-READY-01` only authorizes 9 frozen paths.
- `OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01` only authorizes 8
  frozen paths in one direct single-parent child of the frozen TASK-0098 DRAFT:
  it machine-binds the pushed post-terminal edge `1696739 -> d335159`
  (TASK-0097 canonical terminal -> nextAction alignment fix, only
  `.harness/project-state.yaml`) as the TASK-0098 DRAFT anchor
  (baseCommit = `d335159`), validates the tail project-state `nextAction`
  equals `docs/handoffs/TASK-0097.json` byte-for-byte, and bumps
  harness-change/task-intake/task-delivery-flow to 1.1.7/1.2.7/1.3.7.
  One-time consumption at READY authorization, inert after terminal, never
  reusable; copied record, second consumption, extra commit/path, history
  rewrite and every forbidden interface fail closed. Ordinary READY Doctor
  PASS remains mandatory before implementation.

## Procedure

1. 在任何受保护写入前复验 READY 任务、Context Lock 和人工批准，再转为 IN_PROGRESS。
2. 读取全部 Harness 真源、相关 Accepted ADR 和当前脚本调用链。
3. 先写明唯一真源、派生物、失败场景和兼容边界，再做最小实现。
4. 所有客户端入口必须是 `AGENTS.md` 的原生发现或薄引用，不复制规则正文。
5. 跨平台包装只能调用同一核心实现；命令注册表必须被实现和 CI 实际消费。
6. 为任务、Context、Skill、受保护路径、Diff Scope、Schema 和证据增加自动门禁。
7. 运行任务规定的 Windows/POSIX 检查和单元测试，记录真实失败与修复。
8. 由无历史上下文的独立 Reviewer 复跑关键场景，再进入 ACCEPTED。

## Validation

- `doctor.py --task TASK-ID` 能发现越界 Diff、缺失 Skill、Context 漂移和状态冲突；
- Catalog validate/generate/diff 仍确定性；
- Windows、macOS/Linux/WSL 入口语义一致；
- CI 调用统一入口；
- Evidence 包含命令、状态、退出码、验证提交和产物哈希或无产物理由；
- `git diff --check` 和独立复核通过。

## Forbidden Actions

- Harness 不能为了当前任务放宽自己；
- 不得删除失败检查、降低阈值、吞掉退出码或把 NOT_RUN 伪装成 PASS；
- 不得引入第二套规则、任务、ADR、状态或 Evidence 真源；
- 不得手工编辑生成物；
- 不得把某个 IDE、Agent、SaaS 或付费插件设为必需运行时。

## Evidence Checklist

- [ ] 任务、审批和 Context Fingerprint 有效
- [ ] Diff 未超出白名单
- [ ] 注册表与实现、CI 一致
- [ ] 关键失败场景有自动测试
- [ ] 跨平台入口调用同一实现
- [ ] 独立 Reviewer 已记录结论
- [ ] Handoff 可供新会话恢复
