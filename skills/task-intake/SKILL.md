---
name: task-intake
description: 将需要修改仓库的原始需求收口为可审计的 DRAFT/READY 任务；在没有活动任务、需要明确范围、风险、Context Lock、验收或审批时使用。
metadata:
  id: task-intake
  version: 1.2.7
  riskClass: C1
---

# Task Intake

## Purpose

把原始需求变成仓库内唯一可执行的任务授权，解决“做什么、为什么、能改哪里、不能改哪里、如何证明完成”。

## When to Use

- 用户要求修改或创建仓库内容，但当前没有活动任务；
- Backlog 中的 PLANNED 任务满足依赖、执行顺序和决策闸门，需要晋级为唯一 DRAFT；
- DRAFT 任务需要补齐范围、Owner、风险、验收、Context Lock 或审批后进入 READY；
- 现有活动任务无法覆盖新请求，需要先判断新请求是补充、后续任务还是范围扩张。

只读问答、代码审查和状态查询无需创建任务，但不得借只读名义实施修改。

## Required Inputs

- 用户的可观察目标和明确不做事项；
- Owner 与必要的人类批准；
- 当前干净 Base Commit；
- 需要锁定的仓库相对输入；
- 风险等级、真源、不变量、读写白名单、禁止路径和必跑命令。

## Procedure

1. 读取 `AGENTS.md`、项目状态、生命周期和相关机器真源。
2. 确认不存在另一个活动任务；若存在，判断请求是否属于该任务，否则停止并交由 Owner 排序。
3. 若任务已在 `.harness/task-backlog.yaml` 中登记为 PLANNED，先从最新终态 Base 快照验证它是按执行顺序首个满足全部 ACCEPTED 依赖和 APPROVED 硬决策闸门的任务；硬闸门只接受 `repository-owner`，且 `decisionEvidence` 必须逐项覆盖 `requiredDecisions`，每项同时记录非空 `value` 与 `evidence`。PLANNED 卡只绑定 Backlog 静态规划合同 Hash，正文是非规范渲染；不得包含 Base、授权 Commit、Context、精确命令或 Skill 版本，也不占 `activeTask`、不得执行。
4. 以最后一个终态提交作为新任务唯一 `baseCommit`，不得先提交其他变更再把它们包含进 Base；创建或晋级唯一 DRAFT 任务卡，保持 Backlog 锁定的目标、范围、禁止项、依赖、验收和决策闸门不变，并补齐失败行为、停止条件和前向修复策略。
   唯一例外是机器真源中 `recordId=OWNER-MAINT-20260801-READY-GREENLINE-01` 的
   TASK-0072 精确一次性自举：只有 Doctor 完整验证
   `a737f22362185ed47e81ecabef5c17b22fb52e18` →
   `9725e74019b7a102ff8e848beec466bac7044987` →
   `60b09ec198a0c37b2345576d3cc593bfbe887bd5` →
   单父 maintenance boundary 的提交、Tree、逐文件 blob/mode/content 绑定后，
   TASK-0072 的 DRAFT 才能把该 boundary 作为 `baseCommit`。Task Ledger 中一旦出现
   TASK-0072，该 DRAFT anchor 即已消费；任何其他任务均不得使用或复制它。
5. 以当前 Base Commit 的仓库相对路径内容生成 Context Lock；外部资料先归档或只记录 provenance，不写入可复验路径。
6. 解析受保护路径：`requiredSkillVersions` 固定 Base Commit 中实际执行的版本；若任务升级 Skill，另在 `targetSkillVersions` 声明交付版本；同时列出人工批准和独立复核要求。
7. 需要持久保存 DRAFT 时，只提交字段完整的任务卡与 Context Lock，保持 `project-state.activeTask` 为空；Doctor 不接受同一检查点中的其他路径。
8. Owner 批准目标、风险、白名单和验收后，将任务转为 READY，并在同一授权提交中同步
   `project-state.activeTask`、`activeTaskCard`、`nextAction`、`updatedAt`。该提交只允许任务卡、Context Lock 和
   `.harness/project-state.yaml`，且项目状态的阶段、能力门禁和历史指针必须与 Base Commit 一致。
9. 用后续仅修改任务卡的提交，把 READY 授权提交的完整 Git SHA 写入 `authorizationCommit`；运行
   `doctor.py --task TASK-ID`。通过后才允许实施者转为 IN_PROGRESS。
   TASK-0073 的唯一精确例外发生在普通 DRAFT 提交之后、READY 授权之前：
   只有机器真源中 `recordId=OWNER-MAINT-20260802-TASK-0073-PRE-READY-01`
   的直接单父 maintenance 边可写入记录冻结的 Doctor、目标测试、机器策略、
   Skill 注册与三份精确 Skill 及 Owner 授权证据。Doctor 必须验证 Base
   `ee0757a8749a0ccab53553785b92abb865e4373b`、DRAFT parent、唯一边、
   Commit/Tree、逐路径 mode/type/blob/content 和一次性消费；普通 READY
   Doctor 真实 PASS 前仍不得进入 IN_PROGRESS。该记录不适用于其他 Task，
   不允许第二次消费、额外提交/路径、环境变量、CLI flag、Git note/replace/graft、
   历史改写、可配置 allowlist 或通用 override。
   TASK-0074 的唯一精确例外同样只发生在普通 DRAFT 提交之后、READY 授权之前：
   `recordId=OWNER-MAINT-20260802-TASK-0074-PRE-READY-01` 只允许其冻结的
   11 个路径形成一个直接单父 maintenance 边。Doctor 必须绑定 Base
   `65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94`、TASK-0074 DRAFT、派生
   Commit/Tree、逐路径 mode/type/blob/content、Owner 原文和 TASK-0073
   terminal Commit/Tree 上固定 Evidence/Review Blob/SHA/Reviewer UNKNOWN
   元组；错误身份、复制、第二条记录或任一字段漂移均失败关闭。该边还必须在
   普通 READY Doctor 前登记 TIMEOUT/UNKNOWN 强类型非 PASS、双阶段预算、
   Reviewer 15 分钟上限和 TASK-0074 专用 Windows 合并门禁；它不授权通用
   override、历史产物修改、额外路径/提交或任何禁止接口。
   TASK-0075 的唯一精确例外只接受
   `recordId=OWNER-MAINT-20260803-TASK-0075-PRE-READY-01`，且只能在
   `d41c9f82e69107cf1ecf0cb2c100d39f436faab7` 的普通 DRAFT
   `2289d7a243d8a7658d11036afe6d338e0868cc8e` 后形成一个直接单父、
   11 路径 maintenance 边。Doctor 必须从 TASK-0073/0074 各自历史提交的
   Policy/Blob 验证固定对象，不得用当前 Policy 重判；必须精确隔离 TASK-0074
   的不可变 REJECTED 终态和 10 条错误 tuple。未来 `candidateExecution`
   `NOT_STARTED` 只允许 READY Doctor 非 PASS 且从未 READY PASS、
   IN_PROGRESS 或冻结候选时使用；未来终态 Handoff 与 project-state 的
   `nextAction` 必须逐字一致。Owner 的完整授权计划与“按计划用 goal
   继续下去”必须共同绑定；任一身份漂移、第二条记录、额外路径、历史修改、
   通配写路径或通用 override 均失败关闭。
   TASK-0076: recordId=OWNER-MAINT-20260804-TASK-0076-PRE-READY-01, 9 paths.
   TASK-0098: recordId=OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01,
   8 paths；唯一一次性 post-terminal tail acceptance：DRAFT 锚绑定被接受的后终态
   project-state 对齐修复边 1696739→d335159（baseCommit=d335159），维护边是 DRAFT
   的直接单父子提交且只允许冻结路径集，消费后惰化，禁止复制记录/二次消费/额外路径/
   历史改写/通用 override。
   TASK-0189: recordId=OWNER-MAINT-20260813-TASK-0189-POST-TERMINAL-TAIL-01,
   6 paths；唯一一次性 post-terminal tail acceptance：DRAFT 锚绑定被接受的
   evidence/handoff headCommit 回填 metadata tail 7f9f9e3→c626005
   （baseCommit=c626005，每文件恰将 headCommit 占位 0000... 回填为
   7f9f9e3...），维护边是 DRAFT 的直接单父子提交且只允许冻结路径集，消费后惰化，
   禁止复制记录/二次消费/额外路径/历史改写/通用 override；同一维护边同时实现严格
   限定的 legacy reviewers compatibility（仅终态 C1/C2 且 independentReview:
   not-required 允许缺省 reviewers，其余失败关闭），不得补写 TASK-0185/0186/0187
   历史卡。
   TASK-0196: 记录 OWNER-MAINT-20260814-TASK-0196-PRE-READY-01（pre-READY
   maintenance 边，6 冻结路径）与 OWNER-MAINT-20260814-TASK-0196-POST-TERMINAL-TAIL-01
   （tail 接纳）。唯一历史例外：未登记 post-terminal correction fe0253f→751cb9d
   （TASK-0195 canonical terminal 后仅改 docs/handoffs/TASK-0195.json 的 nextAction
   一行措辞，使 handoff 与 project-state nextAction 逐字一致）作为 TASK-0196 DRAFT
   锚（baseCommit=751cb9d）；legacy healing 三态验证——fe0253f 原始不一致、751cb9d
   唯一改动、751cb9d 后最终一致，不得把 fe0253f 追述为原本一致；maintenance 边是
   修订后最终 DRAFT 的直接单父子提交且只允许冻结路径集，消费后惰化但 provenance
   保留；禁止复制记录/二次消费/额外路径/多父/历史改写/通用 override；不得形成
   "终态后发现不一致即可补一个 tail"的通用流程；新任务 base 位于 canonical
   terminal 后时，仅当 canonical terminal→base 每条父边均被正式登记、精确匹配且
   连续覆盖才放行；Doctor 修复 ACCEPTED/REJECTED blanket continue 时不得用当前
   schema 无差别重判不可变历史制品。
   TASK-0196 RECOVERY-02（append-only 精确恢复边）：记录
   OWNER-MAINT-20260814-TASK-0196-PRE-READY-RECOVERY-02 是 8114da2（已消费但实现
   失败的 pre-READY maintenance attempt，Doctor FAIL 1169 errors）的直接单父子
   提交，恰好修改 7 个冻结路径（原 6 路径中 authorization json 换为
   pre-ready-maintenance-recovery-authorization.json，并新增任务卡路径）；原
   pre-ready-maintenance-authorization.json 与原 policy 记录保留不覆盖、不改写其
   历史含义（第一份记录保持可审计但惰化）；第二份记录只允许修复本次已知失败
   （撤回 blanket terminal evidence 全历史重判，改为独立定向 post-terminal edge
   validator：未登记父边默认失败、登记父边精确匹配一次性记录、原卡 writeAllowlist
   不能授权 post-terminal 修改），不得形成通用 maintenance 后再补 maintenance
   能力；Context Lock 仅当机器验证证明卡修复改变冻结输入时才可修改；TASK-0141
   为 enforcement activation 前已存在且无 post-terminal edge 的历史 nextAction
   不一致——不追溯阻塞、不称 PASS、不改历史制品、记录为独立 legacy governance
   finding 另卡处理、不引入通用 quarantine/ignore 机制；激活后新终态的 nextAction
   当下不一致必须失败，不允许普通事后提交修复。
10. READY 后确需 Owner 修订时，不重写授权提交或放宽原合同：先在 `.harness/task-backlog.yaml` 建立强类型 amendment 合同，并在任务卡 `scopeAmendments` 保存完整 Hash 绑定投影。合同逐项记录 `supersedes` 原条款稳定 ID/原文 Hash 与 `replacement` 原文/Hash；未列条款仍受原授权投影约束。新增写路径只能是规范 POSIX 精确路径，不能是 glob；amendment 必须由 `repository-owner` 批准、append-only，并在只改 Backlog 与任务卡的单父原子治理提交中先落入 Git 历史，未提交 worktree/index 不得自授权。
11. PLANNED 在进入 DRAFT 前被取消或替代时，不伪造动态执行证据；保留原卡和 Backlog 条目，把原卡 state 与
    append-only `resolutions` 原子登记为同一 REJECTED/SUPERSEDED，并记录非空原因、决策人、时间和替代 ID。
    该规划终态不进入执行 Task Ledger；其中 SUPERSEDED 只允许从 PLANNED 进入。已进入 DRAFT 的任务只能在
    ACCEPTED/REJECTED 时，以单父提交原子更新任务卡、项目状态并把本任务追加到 `.harness/task-ledger.yaml`；同时加入 Evidence Pack 与 Handoff。已执行任务被替代时以 REJECTED 保留原因，并为替代方案分配新的永久 ID；Backlog 条目和永久 ID 不得删除或复用。历史条目和其绑定的任务卡、
   Evidence、Handoff 不可删除或改写。提交前完整暂存候选快照，并用 `doctor.py --task TASK-ID --pre-closure` 检查候选闭包；正式
   Doctor/Precheck 只接受已经形成真实 Git 提交的终态。

## Validation

- 任务字段满足 `docs/tasks/task-card-template.md`；
- Context Fingerprint 可从 Base Commit 独立复算；
- 当前授权字段与 `authorizationCommit` 中的 READY 任务完全一致；
- Owner amendment 与 Backlog 强类型合同、任务卡 Hash 投影和其单父引入提交完全一致；对每个 parent edge 保持 append-only，不追溯授权先前改动；
- READY 授权提交与 `project-state` 的活动任务投影是同一原子事务；
- `authorizationCommit` 必须是 Base 后首个 READY、单父提交；其父节点只能是 idle Base 或未绑定 DRAFT，不能事后前移授权锚；
- 任务历史完全从 `baseCommit` 后分叉；逐父边变更并集不包含白名单外路径，改后恢复也不能绕过；
- 正式 Doctor 前完整暂存候选快照，Index 与工作树内容一致；
- 终态任务已登记到 append-only Task Ledger，历史审计产物仍与首次登记提交一致；
- `writeAllowlist` 不与 `forbiddenPaths` 冲突；
- 所需 Skill 均在 `.harness/skills.yaml` 注册并固定版本；
- C3/C4 的批准与独立复核要求已声明；
- 同一时刻最多一个活动任务。
- 可存在多个 PLANNED，但最多一个 DRAFT；PLANNED 不得携带动态证据或作为 Diff Scope 执行授权。
- Backlog 中已登记的 Task ID、名称和静态规划合同不可删除、复用或静默改写。
- planning-only 卡的六个精确元数据字段、标题、固定声明与恰好六个非空正文节形成完整历史投影；引入后改坏再恢复也必须失败。

## Forbidden Actions

- 不得在 intake 过程中实现业务代码；
- 不得用多张 DRAFT 冒充规划队列，或绕过 Backlog 顺序、依赖和硬决策闸门；
- 不得由 Agent 伪造 Owner 批准或把沉默视为批准；
- 不得为容纳已经发生的越界修改而倒推放宽白名单；
- 不得用 `acceptanceAdditions`、聊天说明、未提交 amendment、目录别名或宽泛 glob 覆盖原授权；未显式 `supersedes` 的条款保持原 Hash 与语义；
- 不明确的关键边界必须标为 BLOCKED；
- 不得把历史聊天当作唯一 Context 输入。

## Evidence Checklist

- [ ] Base Commit 和 Context Fingerprint 有效
- [ ] 目标、范围外和停止条件明确
- [ ] 写入白名单与禁止路径可机器校验
- [ ] Skill、审批和 Reviewer 要求已声明
- [ ] 验收与必跑命令可复测
