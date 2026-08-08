# TASK-0101：数据库持续门禁（P1-10 + P2-28）

```yaml
taskId: TASK-0101
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
baseCommit: 0a70e9425e85da6f20ed5aac55200a63d0996d50
authorizationCommit: "49302802a1c36db6f87122c20aa79f1998d3874b"
contextFingerprint: 4023739df346a680185fb37f0cebdd1ebf46edf36f3c3763cfb4f61dc4879065
contextLock: docs/tasks/context/TASK-0101.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0101_DATABASE_CI_GATE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0100-realtime-db-consistency.md
  - docs/evidence/TASK-0100/evidence-pack.json
  - docs/handoffs/TASK-0100.json
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - infra/db/run-rls-tests.sh
  - .github/workflows/ci.yml
writeAllowlist:
  - docs/tasks/TASK-0101-database-ci-gate.md
  - docs/tasks/context/TASK-0101.context-lock.yaml
  - infra/db/run-rls-tests.sh
  - .github/workflows/ci.yml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0101/**
  - docs/handoffs/TASK-0101.json
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/copilot-instructions.md
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0100-realtime-db-consistency.md
  - docs/evidence/TASK-0100/**
  - docs/handoffs/TASK-0100.json
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - specs/**
  - service/**
  - frontend/**
  - infra/db/tests/**
  - mvnw
  - mvnw.cmd
  - pom.xml
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - .github/workflows/ci.yml
  - infra/db/run-rls-tests.sh
  - docs/tasks/TASK-0100-realtime-db-consistency.md
  - docs/handoffs/TASK-0100.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 8 分配数据库持续门禁合并卡（P1-10 43 个
      PostgreSQL/RLS/事务测试完全不在 PR CI + P2-28 PostgreSQL runner readiness
      启动竞态）：run-rls-tests.sh readiness 改为稳定窗口（连续 SQL 成功探针，只对
      已识别启动连接错误有限重试）以关闭 P2-28；把 digest 固定的 pgvector/PostgreSQL
      DB job 接入 PR CI（全迁移 + 全部 SQL 套件，失败保留 migration/readiness 日志）
      以关闭 P1-10。ID 从 TASK-0101 起核对未占用后分配；本卡为 TASK-0100 ACCEPTED
      后 nextAction 逐字一致的下一卡；TASK-0100 实测 P2-28 竞态 9/10 首轮失败，
      修复优先。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 批准 TASK-0101 修改 `.github/workflows/ci.yml`（C4 保护路径，
      requiredSkill=harness-change）与 `infra/db/run-rls-tests.sh`：新增 digest
      固定的 PostgreSQL 18 + pgvector DB job（执行完整 V1-V15 迁移 + 全部 SQL
      套件 01-50，失败阻断合并，失败保留 migration/readiness 日志 artifact）；
      run-rls-tests.sh readiness 改稳定窗口（连续 SQL 成功探针，对已识别启动连接
      错误有限重试）。harness-change skill 1.1.7；writeAllowlist 覆盖完整文件集
      （ci.yml + run-rls-tests.sh + 生命周期文件）；独立 Reviewer 按 C4 要求。
      本卡不改任何 `.harness/**` 机器真源（除 project-state/task-ledger 生命周期
      字段），不改 scripts/harness/**，不改其他 workflow 文件。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0101
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095/0096/0097/0098/0099/0100 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0101 起）。修改对象：`.github/workflows/ci.yml`（C4 保护路径，harness-change + humanApproval）+ `infra/db/run-rls-tests.sh`（DB runner；审计 P1-10/P2-28 明确列出修复路径）。`run-rls-tests.sh` 不在 protected-paths.yaml 保护表内，但按 Owner 交接指示本卡整体按 C4 harness-change 治理（humanApprovals 已预填）。

## 背景与用户可观察目标

审计确认数据库验证存在两个缺陷：

1. **P1-10**：`infra/db/run-rls-tests.sh` 会应用迁移并运行全部 SQL 测试（现 01-50），但 GitHub Actions CI 没有任何 DB job——backend job 只执行 Maven verify。RLS、终态原子性、token rotation、迁移兼容性与权限回归可以在 PR 中合并，历史手工 50/50 PASS 不是持续 gate。
2. **P2-28**：`run-rls-tests.sh` 的 readiness 判定是单点 `pg_isready` 成功即 break。pgvector 容器 entrypoint 先 initdb（临时 server 短暂 "accepting connections" 但 `vc` 库未建、随后重启），落在临时 server 窗口时迁移阶段报 `database "vc" does not exist` 或连接中断——2026-08-08 冻结 runner 实测 **9/10 次首轮失败**（warm 环境竞态近乎确定性），第 10/11 次才通过。

本卡完成后，用户能观察到：PR CI 中新增 digest 固定的 PostgreSQL 18 + pgvector DB job，执行完整 V1-V15 迁移与全部 SQL 套件（01-50，自动拾取），失败阻断合并并保留 migration/readiness 日志 artifact；`run-rls-tests.sh` 连续多轮全新容器首轮稳定通过（不再出现 P2-28 启动竞态首轮失败），迁移阶段只对已识别启动连接错误有限重试，其余失败如实传播。

## 范围内

- **`infra/db/run-rls-tests.sh`（P2-28）**：
  - readiness 判定从单点 `pg_isready` 改为**稳定窗口**：连续 ≥3 次 `docker exec psql -U postgres -d vc -c "SELECT 1"` 成功（探针目标库 `vc`——initdb 临时 server 与 entrypoint 建库临时 server 都没有 `vc` 库，只有最终 server 存在；SQL 探针天然覆盖容器 health + 目标库存在性）；探针失败清零计数；总预算 200 次 × 0.5s（100s）。
  - 迁移阶段**只对已识别启动连接错误有限重试**（≤3 次/文件）：`connection refused`、`could not connect to server`、`server closed the connection unexpectedly`、`terminating connection due to administrator command`、`Connection to server was lost`、`database system is starting up`；其他失败立即传播（保持 `set -euo pipefail` + `ON_ERROR_STOP=1`）。
  - **失败保留日志**：readiness 失败打印容器日志与探针日志；迁移失败打印迁移输出；所有输出写入 `$VC_DB_LOG_DIR`（CI 设置后上传为 artifact；本地默认 `mktemp -d /tmp/vc-db-logs.XXXXXX`）；测试失败照旧打印 FAIL 输出并追加到 tests.log。
- **`.github/workflows/ci.yml`（P1-10）**：
  - 新增 `database` job（`runs-on: ubuntu-latest`，`timeout-minutes`）：digest 固定容器 `pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`（与 run-rls-tests.sh 冻结一致），**复用 `bash infra/db/run-rls-tests.sh` 作为唯一执行入口**（不复制第二套 runner 逻辑），`VC_DB_LOG_DIR` 指向 workspace 内日志目录。
  - 失败保留日志：`if: failure()` 时 `actions/upload-artifact` 上传 DB 日志目录（`if-no-files-found: ignore`）。
  - job 非零退出在 PR 上阻断合并（required check 语义 + 红 status）。
- **测试/验证**：
  - 全新容器连续多轮首轮实测 `run-rls-tests.sh`（P2-28 关闭证据：连续 ≥3 轮 fresh container 首轮 50/50 PASS，无重跑）。
  - `git diff --check`、canonical precheck 5/5（doctor/catalogValidate/catalogDrift/paidFeatureCheck/betaRosterGate）。

## 明确范围外

- 不修 P2-23（Actions 固定 commit SHA——ci.yml 全部既有 job 保持现状，新 job 沿用仓库既有 action major tag 风格，P2-23 属工作包 15）、P2-26（precheck/CI timeout 机制——既有 job 不加、命令注册表不改；本卡仅为新 DB job 设 timeout-minutes 防御，不关闭 P2-26）、P2-27（Windows/Linux 矩阵——不加矩阵）、P2-21（canonical Python 平台入口）、P3-01（OpenAPI drift gate）。
- 不修 P3-07（run-rls-tests.sh 头注释"five tests"与 `for $(ls ...)` 安全 glob——审计独立项，保持现状，本卡不顺手改；Handoff 如实列为 remaining）。
- 不改 `.harness/**` 机器真源（除 project-state/task-ledger 生命周期字段）、`scripts/harness/**`、`skills/**`、`docs/schemas/**`、`specs/**`、`service/**`、`frontend/**`、`infra/db/tests/**`、`ci/**`、其他 `.github` 文件。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。
- 不引入新依赖、SaaS、付费运行时或第二套 runner 逻辑。

## 输入和前置条件

- Base Commit 固定为 `0a70e9425e85da6f20ed5aac55200a63d0996d50`（TASK-0100 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0101 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- DB 验证在 OrbStack Docker（`pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`，与 run-rls-tests.sh 冻结一致）内执行：全新容器应用 V1-V15 全量迁移 + 全部 SQL 测试（01-50）。
- 本卡触碰 `.github/workflows/**`（C4 保护路径，requiredSkill=harness-change）：使用 `harness-change` skill 1.1.7、Owner 人工批准（humanApprovals 已预填 task-assignment + harness-change）、独立 Reviewer。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供（`~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀解析）。
- 每次 doctor/precheck 使用干净 `TMPDIR=$(mktemp -d ...)`，避免旧 receipt 命中。
- CI YAML 语法本地校验：`python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`（YAML 合法），并对照既有 job 缩进/结构人工核对（Actions 配额耗尽无法真实触发 workflow）。

## API / 事件 / 数据契约

- `run-rls-tests.sh` 行为契约：
  - 环境变量 `VC_DB_LOG_DIR`（可选）：日志目录；未设置时使用 `mktemp -d /tmp/vc-db-logs.XXXXXX`。脚本在开始时创建目录并打印 `log dir:`。
  - 退出码：0 = 全部测试 PASS；2 = 迁移目录缺失；3 = readiness 稳定窗口超时；非零（psql/迁移/测试失败原样传播）不吞退出码。
  - readiness 稳定窗口：连续 3 次 `psql -d vc -c "SELECT 1"` 成功（每次间隔 0.5s，总预算 200 次）；不再使用 `pg_isready` 作为就绪判据（可保留注释说明）。
  - 迁移重试：每文件最多 3 次；仅当失败输出匹配已识别启动连接错误模式时重试（间隔 1s）；最终失败打印迁移日志路径并以原退出码失败。
  - 日志文件：`$VC_DB_LOG_DIR/readiness.log`（探针失败输出）、`$VC_DB_LOG_DIR/migration.log`（每个迁移文件每次尝试的输出，带 `--- <file> attempt N ---` 分隔）、`$VC_DB_LOG_DIR/tests.log`（每测试 PASS/FAIL + 失败输出）。
- `ci.yml` 新增 `database` job 契约：PR 与 push main 均触发；非零退出阻断合并；失败上传日志 artifact（`if: failure()` + `if-no-files-found: ignore`）；容器/镜像/迁移/测试与 run-rls-tests.sh 完全一致。
- 无 OpenAPI/Java/前端/DB schema 契约变更。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据、凭据或外部服务；DB 数据仅为合成 fixture；容器临时（`--rm`、匿名 volume、无 host 端口绑定），与 backlog `testPolicies.database` 一致。
- workflow `permissions: contents: read` 保持不变；upload-artifact 写入 Actions 存储，不写仓库。
- 不给任何角色 BYPASSRLS；不修改任何 SQL 测试与迁移。
- 日志内容为迁移/readiness/测试输出，不含凭据（容器密码为合成值 `vc`）。

## 状态机和失败行为

- readiness：稳定窗口未达成（200 次）→ 打印容器日志 + 探针日志 + 退出 3；窗口达成后才进入迁移。
- 迁移：已识别启动连接错误 → 有限重试（≤3）；其他错误 → 立即失败（打印迁移输出 + 日志路径）；`set -euo pipefail` 保持。
- 测试：任一失败 → `FAIL <name>` + 输出，最后 `SOME TESTS FAILED` + 非零退出（既有语义保持）。
- CI：DB job 失败 → PR 红（阻断合并）+ 日志 artifact；本地等价验证（全新容器全量迁移 + 全部 SQL 套件）为备用通道（Owner 既有授权）；remote 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095/0097/0098/0099/0100 先例）。
- 任一命令失败/超时/NOT_RUN 永不转换为 PASS；Evidence 如实记录真实退出码、Commit/Tree 与验证环境。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆、SafetyGate；不引入新依赖、SaaS 或付费运行时。
- CI YAML 中不出现任何凭据/Token；容器密码为合成值，仅在 runner 环境变量中传递。

## 验收标准

1. **P2-28 稳定窗口**：`run-rls-tests.sh` readiness 不再依赖单点 `pg_isready`；改为连续 ≥3 次 `psql -d vc -c "SELECT 1"` 成功的稳定窗口（探针目标库 `vc`），总预算 ≥100s；readiness 失败打印容器日志与探针日志并退出 3。
2. **P2-28 有限重试**：迁移阶段只对已识别启动连接错误（connection refused / could not connect / server closed the connection / terminating connection due to administrator command / database system is starting up / Connection to server was lost）重试且每文件 ≤3 次；其他失败立即传播（不吞退出码、不加 skip）。
3. **P2-28 首轮稳定**：冻结 runner 全新容器**连续 ≥3 轮首轮**执行 V1-V15 全量迁移 + 全部 SQL 套件（01-50）全部 PASS，无 P2-28 竞态首轮失败（每轮 fresh container，不重跑）。
4. **P1-10 DB job**：`.github/workflows/ci.yml` 新增 `database` job——digest 固定 `pgvector/pgvector:0.8.5-pg18@sha256:12a379...` 容器、复用 `bash infra/db/run-rls-tests.sh` 单一入口执行完整迁移 + 全部 SQL 套件、失败非零退出阻断合并、`if: failure()` 上传 DB 日志 artifact（migration/readiness 日志保留）。
5. **CI YAML 合法性**：YAML 可解析；job 结构与既有 job 一致（indentation/action 用法）；无凭据硬编码。
6. **交付闭环**：Diff 仅含 writeAllowlist；canonical Precheck 全 PASS（doctor 等 5 命令）；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`bash infra/db/run-rls-tests.sh` 是任务特有 DB 门禁（precheck 不含 DB 套件），只运行一次（P2-28 首轮稳定性由额外多轮 fresh container 实测佐证，记录为定向验证）；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。

## 回滚或前向修复

- 修复采用最小脚本与 workflow 变更；若 DB 套件在修复后仍有失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- runner 在全新容器内重放，天然可重试；无持久数据，回滚 = 修正文件后重跑全新容器。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C4；若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如其余 workflow 文件、scripts/harness/**、.harness/** 机器真源、infra/db/tests/**、specs/** 等）时立即停止并询问 Owner。
- 需要扩大 P2-28 修复范围到 P3-07（注释/glob 重构）、P2-23（action SHA 固定）、P2-26（全局 timeout 机制）、P2-27（矩阵）等审计项时停止并报告，不得顺手修。
- 冻结镜像在稳定窗口下仍无法确定性通过（如真实迁移错误）时停止并报告，不得降级为断言跳过或加 skip。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0101/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0101.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
