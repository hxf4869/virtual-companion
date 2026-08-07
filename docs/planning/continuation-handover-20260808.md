# Virtual Companion 延续工作交接文档

> **交接日期**：2026-08-08
> **交接人**：Claude（上一会话，已结束）
> **接收对象**：接续开发的新 Agent（**无上一会话记忆，本文件必须完整读完再动手**）
> **仓库**：`G:\ai\hxf\virtual-companion`（Windows 11 + Git Bash；WSL2 `Ubuntu-24.04` 可用；原生无 docker，docker 在 WSL 内）
> **当前 HEAD**：`dbe5d47`（全推送 origin，0 ahead / 0 behind）

---

## 0. 这份文档是什么

上一会话完成了 **TASK-0036（Technical Alpha 总验收）ACCEPTED**（长线治理交付终点，Backlog executionOrder 已尽），并产出了 **3 张延续卡的设计文档**（`docs/planning/`）。接下来由你（新 Agent）**逐张执行这 3 张卡**。

本文件 = 仓库治理规则速查 + 当前状态 + 3 张卡设计摘要 + 完整 intake 流程 + 精确验证命令 + 已踩过的坑。**先完整读，再动第一个提交。**

---

## 1. 会话恢复（每会话必做）

按仓库 `AGENTS.md` 会话恢复流程：

1. 读 `.harness/` 下机器真源：`project-state.yaml`、`task-ledger.yaml`、`task-backlog.yaml`、`sources-of-truth.yaml`、`invariants.yaml`、`protected-paths.yaml`、`task-lifecycle.yaml`。
2. 运行 `python scripts/harness/doctor.py --summary`（约 4–5 分钟，37–44 万 checks；**只有 python3 时用 python3**）。
   - **doctor 前**把 `.serena/` 移出工作树（`mv .serena /tmp/...`，untracked 污染 diff scope），跑完再恢复。
3. 读活动任务、Context Lock、`.harness/skills.yaml` 中任务要求的精确 Skill 版本。
4. 单卡交付还要读 `.harness/task-delivery-policy.yaml` + `skills/task-delivery-flow/SKILL.md` + `skills/task-intake/SKILL.md`。
5. 只读本任务需要的 Accepted ADR、机器真源、代码调用链；`docs/source/**` 与历史聊天**不是真源**。

**当前状态速查**（2026-08-08）：
- Phase = `TECHNICAL_ALPHA`；`activeTask = null`（无活动任务）；`lastAcceptedTask = TASK-0036`。
- Backlog `executionOrder` 已尽（TASK-0012…0036，TASK-0036 是末卡）→ **无 nextPromotable**。
- 两闸门 APPROVED：GATE-IDENTITY-PROVIDER-SESSION（Spring Security+JWT）、GATE-LIVE-MODEL-PROVIDER（获批供应商 {OpenAI, Anthropic}）。
- 依赖卡 TASK-0026/0030/0032/0034/0035 与总验收 TASK-0036 全部 ACCEPTED 并推送。

---

## 2. 后续工作：3 张延续卡（你要做的）

TASK-0036 handoff 记录了 Technical Alpha 完成后仍未接线的剩余项。上一会话拆成 3 张独立单卡，**设计文档在 `docs/planning/`**：

| 卡 | 设计文档 | 一句话 | 建议顺序 |
|---|---|---|---|
| **TASK-0090** | [TASK-0090-outbound-lifecycle-wiring.md](docs/planning/TASK-0090-outbound-lifecycle-wiring.md) | 真实外发路径接入生成生命周期（backend） | 第 1 张 |
| **TASK-0091** | [TASK-0091-provider-deployment-persistence.md](docs/planning/TASK-0091-provider-deployment-persistence.md) | 获批部署持久化供给（backend） | 第 2 张（与 0090 独立） |
| **TASK-0092** | [TASK-0092-h5-auth-transport-completion.md](docs/planning/TASK-0092-h5-auth-transport-completion.md) | H5 认证接线 + 运输完成（frontend） | 第 3 张（**依赖 TASK-0090 端点**） |

**执行方式**：独立单卡交付（TASK-0080–0088 先例），**无需扩展 backlog**——新卡不写 `planningBacklog`/`planningContractHash`，直接以 DRAFT 创建（doctor 放行：非 backlog 绑定卡不要求 backlog 条目，`plannedRequiresBacklogEntry` 只约束 PLANNED 态）。

依赖关系：**TASK-0092 → TASK-0090**（前端需后端 realtime/ticket HTTP 端点）；0090 与 0091 相互独立。先做 0090。

### 2.1 TASK-0090 设计摘要（详见设计文档）

**目标**：把 TASK-0035 的 `LiveModelInvoker`（当前**无生产调用入口**，仅 Spring bean + 单测）接入真实生成生命周期，做成 send-generation → 路由/双授权/安全/配额 → 真实外发 → 终态落库 → 结算 → SSE 推送的端到端闭环。

**范围内**：runtime send-generation controller/service（OpenAPI `sendGeneration` 契约已有无实现）→ receive_generation（V6 幂等）→ 状态推进（无 generic transition 函数，需新建）→ 组装 LiveInvocationRequest（`OwnershipTuple` String↔DB bigint 映射）→ invoke → **LiveAttemptOutcome→GenerationState 终态映射** → **新建 provider_attempt 表**（V1–V14 不存在）落库审计 → usage→generation_usage → 配额结算（失败 RELEASE / 成功 finalize SETTLE）→ realtime_event 落库 + **POST /api/v1/realtime/tickets + GET resume SSE HTTP 端点**（V8 函数已有，无 controller）。

**范围外**：不改 Router/Guard/SafetyGate 核心；不改 frontend（0092 做）；Beta/公开注册/真实支付。

**受保护面**：`**/db/migration/**`（database-migration C4 + **humanApproval**）+ 可能 `service/**/modelruntime/**`（model-routing-change C3 independentReview）+ runtime（unprotected）。**intake 时用 complexityGate 评估是否 split**（本卡体量大，可能拆"运行时编排 + 持久化/审计落库"两半）。

### 2.2 TASK-0091 设计摘要

**目标**：`JdbcProviderDeploymentRepository`（死代码）接线为可装配 bean，`ApprovedModelProviderProvisioner` 把获批 enabled 部署 UPSERT 到 `provider_deployment`（supplier→DB 单向同步），datasource 条件化（默认关，不破坏无 DB 上下文测试）。

**范围内**：@Repository/@Bean + 单测（UPSERT/findByProviderId/findAdmitted，含 text[] capabilities 数组往返）；datasource 条件化（复用 auth.datasource-enabled 或新增键，intake 定）；供给流程先持久化再注册内存 registry；DB 失败关闭。

**注意**：V4 `provider_deployment` 的 INSERT/UPDATE 仅授权 `vc_job_coordinator`——运行期连接角色必须匹配，否则 UPSERT 被拒。

### 2.3 TASK-0092 设计摘要

**目标**：VC_AUTH_ENABLED=true 下 chat/memory 页面可用（当前 transport 无 Bearer 会 401）+ 关闭 TASK-0026 P2-1/P2-2。

**范围内**：memory.vue 内联 fetch transport → `createAuthenticatedTransport`（接口结构相同，stores 调用点零改动）；chat.vue resume() 加 Bearer + 单次 ticket 流（先 POST tickets 再 SSE，ticket 不入 localStorage/query）；readSseEvents 捕获 nextEpoch；401→onUnauthorized 跳登录；transport 逻辑抽到可测模块 + vitest。

**依赖**：TASK-0034（createAuthenticatedTransport）+ TASK-0026（.vue transport）+ **TASK-0090（后端端点）**。

---

## 3. 独立单卡 intake 完整流程（照做）

以一张卡（如 TASK-0090）为例。**所有提交严格遵循 `git add` 精确路径**。

### 3.1 准备工作（写 DRAFT 前）
- baseCommit = 当前 HEAD（`git rev-parse HEAD`，须全 40 位小写）。
- 设计 readAllowlist（本卡要读的所有文件，含治理文件 + 相关代码/测试 + 依赖卡 evidence）。
- **生成 context lock**：对 readAllowlist 每个路径取 `git show <base>:<path>` 原始字节的 sha256；fingerprint = `sha256("\n".join(sorted(f"{path}={digest}")))`；输出 `docs/tasks/context/TASK-XXXX.context-lock.yaml`。已写脚本模板：`C:\Users\k\AppData\Local\Temp\vc-session-20260808\gen_context_lock.py`（改路径列表即可复用）。
- planningContractHash：**独立卡无**（不写 planningBacklog/planningContractHash 字段）。

### 3.2 DRAFT 提交
- 写任务卡 `docs/tasks/TASK-XXXX-*.md`（state: DRAFT，含 deliveryBudgets/complexityAssessment/validationPlan/readAllowlist/writeAllowlist/forbiddenPaths/sourcesOfTruth/requiredInvariants/humanApprovals/independentReview/requiredCommands）。参考 `docs/tasks/task-card-template.md` + 已交付卡（`docs/tasks/TASK-0036-technical-alpha-acceptance.md` 是 C2 docs-only 例；`TASK-0035` 是 C3 例）。
- DRAFT 提交**只允许**卡 + context lock 两个文件。`git commit -m "TASK-XXXX DRAFT: <title>"`。
- **重要**：commit 后把卡与 context lock 的**工作树行尾统一为 LF**（见 §7 坑 1），否则后续 doctor 报 "Context Lock changed after READY checkpoint"。

### 3.3 READY 授权提交
- 卡 state: DRAFT→READY（只改这一行）。
- `project-state.yaml`：activeTask=TASK-XXXX、activeTaskCard、nextAction（描述本卡工作）、updatedAt。
- 提交**只允许**卡 + `project-state.yaml`。`git commit -m "docs: authorize TASK-XXXX READY (...)"`。

### 3.4 authorizationCommit 绑定提交
- 把 READY 授权提交的完整 SHA 写入卡 `authorizationCommit` 字段。
- 提交只改卡。`git commit -m "docs: bind TASK-XXXX authorizationCommit to READY checkpoint <sha>"`。

### 3.5 READY doctor
- `python scripts/harness/doctor.py --task TASK-XXXX`（后台跑，约 2–5 分钟）。**PASS 后才能 IN_PROGRESS**。

### 3.6 IN_PROGRESS 提交
- 卡 state: READY→IN_PROGRESS，提交只改卡。`git commit -m "TASK-XXXX IN_PROGRESS: <title>"`。

### 3.7 实现 + 验证（迭代）
- 实现业务代码；用 targeted checks 迭代（policy 允许 bounded iteration，不消耗 canonical）。
- **候选冻结前清场**：把 R1/review 产物、`.serena/`、`service/apps/runtime/bin/` 等 untracked 移出工作树（见 §7 坑 2/3）。
- 候选提交：实现完成后提交（含代码 + 相关改动）。候选 = 最后一个实现提交。

### 3.8 R1 独立复核
- `independentReview: required` 的卡必须独立 Reviewer（后台 subagent，无历史上下文的独立评审），写 `docs/evidence/TASK-XXXX/review-r1.md`，返回 Verdict + findings。
- blocking = P0/P1/ACCEPTANCE_VIOLATION/INVARIANT_VIOLATION；non-blocking = P2/P3。
- 有 blocking 则最多 1 个 fix batch + R2 finding-closure；**无 P0/P1 时 P2/P3 可接受/记 handoff**（先例：TASK-0026/0030/0034 P2/P3 deferral）。

### 3.9 候选 canonical + exact-tree
- 候选树干净工作树/干净 index 上跑：`python scripts/harness/precheck.py --task TASK-XXXX` + 卡内 requiredCommands 全部命令。
- 验证通道：`.harness/ci-execution-policy.yaml` 默认 `PRIMARY_REMOTE_EXACT_SHA`，本地回退 `LOCAL_EXACT_TREE_FALLBACK`（需 READY 冻结 profile + 强类型 QUOTA 不可用证据 + Owner 授权范围）——先例卡均用 LOCAL_EXACT_TREE_FALLBACK + profile `precheck`。

### 3.10 Evidence + Handoff + Pre-closure + Terminal
- `docs/evidence/TASK-XXXX/evidence-pack.json`（taskId/baseCommit/headCommit/contextFingerprint/reviewers/checks；每个 check：command/status/exitCode/artifactHash/verifiedCommit）— headCommit = **候选提交 SHA**（非 closure commit）。
- `docs/evidence/TASK-XXXX/pre-closure-request.json`（candidateCommit/candidateTree/doctorCheckCount/testCount/reviewerVerdict/ready）。
- `docs/handoffs/TASK-XXXX.json`（taskId/state/baseCommit/headCommit/evidencePath/completed/remaining/knownRisks/nextAction/reviewers）。
- **pre-closure**：`python scripts/harness/doctor.py --task TASK-XXXX --pre-closure`（staged 全部闭包文件后跑）。
- **terminal 提交**：原子更新卡(state→ACCEPTED) + project-state(activeTask=null/lastAccepted+lastTerminal=本卡/nextAction) + task-ledger(追加本卡 ACCEPTED) + evidence + handoff。单父提交。
- **push** + 远端复核 `git rev-list --left-right --count HEAD...origin/main` = `0 0`。

---

## 4. 关键治理规则（违反即 doctor FAIL）

- **Skill 版本**：`task-delivery-flow 1.3.6`、`task-intake 1.2.6`（`requiredSkillVersions` 精确写）。其他按卡面（database-migration/model-routing-change 等见 `.harness/protected-paths.yaml`）。
- **protected-paths**（`forbiddenPaths` 优先）：
  - `**/db/migration/**` → C4 **database-migration + humanApproval**（humanApprovals 里 scope **必须等于 skill id**，不是 task-authorization）。
  - `service/**/modelruntime/**` → C3 **model-routing-change + independentReview**（不需要 humanApproval）。
  - `docs/tasks/**`、`docs/evidence/**`、`docs/handoffs/**` → C2 **task-intake**。
  - `specs/catalog/**`、`specs/contracts/**`、`specs/generated/**` → C3 catalog/contract-change + independentReview。
  - `service/**/safety/**`、`service/**/memory/**` → C4/C3 + humanApproval/independentReview。
  - `.harness/**`、`scripts/harness/**`、`skills/**`、`AGENTS.md` → C4 harness-change + humanApproval。
- **writeAllowlist** 必须在 READY 前冻结；READY 后不可扩权（doctor "authorized field changed after READY checkpoint"）。intake 一次性算对。
- **humanApprovals.scope**：db/migration 卡必须 `database-migration`；frontend 无 protected surface → `task-authorization`。
- **complexityGate**（`.harness/task-delivery-policy.yaml`）：split 当 distinctCrossRiskSurfaces ≥ 2（surfaces: GOVERNANCE/AUTHORIZATION/HISTORY）或 estimatedWallMinutes > 90。intake 前评估。
- **budgets**：candidateDeadline 45min、targetWall 60min、hardFuse 90min、maximumFixBatches 1、maximumReviewRounds 2、r3Forbidden。
- **证据真实性**：Evidence 的 PASS 必须绑定实际执行与精确 SHA；失败/取消/超时/NOT_RUN 永不转 PASS；不删测、不加 skip、不吞退出码。
- **终态**：terminal 提交单父；`handoff.nextAction` 与 `project-state.nextAction` **逐字一致**。

---

## 5. 精确验证命令（照抄）

仓库根 `G:\ai\hxf\virtual-companion`，cwd 在仓库根执行：

```bash
# canonical precheck（含 doctor+catalogValidate+catalogDrift+paidFeatureCheck+betaRosterGate）
python scripts/harness/precheck.py --task TASK-XXXX

# Maven 全模块（WSL docker；原生无 docker！冻结 argv 不可用 "cd service && mvn"）
wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'docker run --rm -v /mnt/g/ai/hxf/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine mvn -o -pl service/apps/runtime -am test'

# RLS 39 项 SQL 矩阵（WSL docker pgvector）
wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'cd /mnt/g/ai/hxf/virtual-companion && bash infra/db/run-rls-tests.sh'

# OpenAPI
python scripts/dev/openapi_tool.py validate
python scripts/dev/openapi_tool.py diff --fail-on-drift

# Harness 单测（239 tests，约 10 分钟；后台跑，别 pipe 掉退出码）
python -m unittest discover -s scripts/harness/tests -p test_*.py

# 前端
bash -c "cd frontend && npx vitest run"
bash -c "cd frontend && npx vue-tsc --noEmit"

# 医生
python scripts/harness/doctor.py --task TASK-XXXX
python scripts/harness/doctor.py --task TASK-XXXX --pre-closure

git diff --check
```

**后台命令注意**：后台 bash 的 cwd 以启动时为准——`cd frontend` 后后台命令会找不到仓库根路径（unittest 报 ImportError start dir）。后台命令显式 `cd` 到仓库根或用绝对路径。**别用 `| tail` 吞退出码**（`PASS` 必须真实 exit 0；要截断用 `${PIPESTATUS[0]}`）。

---

## 6. 关键坑（已踩过，务必避免）

1. **行尾 LF vs CRLF**：`core.autocrlf=true` 使 git blob 存 LF、工作树 CRLF。doctor 读 `read_repository_bytes`（工作树）比对 `git_object`（blob）——**新建的卡/context-lock/evidence 文件若工作树是 CRLF 会报 "Context Lock changed after READY checkpoint" / "card heading must preserve reserved ID/title"**。修法：commit 后 `python -c "d=open(f,'rb').read().replace(b'\r\n',b'\n'); open(f,'wb').write(d)"` 把工作树统一 LF，再 `git add` 刷新 stat cache。
2. **worktree 清场**：R1/R2 独立 reviewer 写的 review-r1/r2.md 在 worktree untracked，candidate 验证时 `test_doctor_accepts_current_task` / precheck 报 "changed path not staged / snapshot disagree"。**候选 precheck/unittest 前把 untracked 产物移出工作树**（`mv review-r1.md /tmp/...`），跑完恢复，closure 提交后即 committed。
3. **`.serena/` 与 `service/apps/runtime/bin/`**：前者是 Serena agent 工具缓存，后者是 Eclipse 输出目录（含 .class/.project）——**都不提交**，保持 untracked。doctor 前移出。
4. **mvn 冻结 argv**：卡里写 `bash -c "cd service && mvn ..."` 在 service 目录无 pom 不可执行。实际 evidence 用 §5 的 WSL docker 命令。
5. **evidence-pack 时机**：pre-closure doctor PASS 后再补 pre-closure check 项并 re-stage；headCommit=最后实现 candidate（非 closure commit）。
6. **nextAction 一致**：写前先核 backlog/ledger 确认下一张可晋级卡；handoff 与 project-state 的 nextAction 逐字一致。
7. **YAML 陷阱**：card YAML plain scalar 禁含 `: `（冒号+空格）与 ` #`（行内注释截断）；evidence/handoff JSON 用 UTF-8 写（Windows 校验用 `open(f, encoding='utf-8')`）。
8. **candidate 验证前必须精确暂存完整候选**：Index 与工作树不一致时禁止终态检查。
9. **authorizationAmendments 对产品卡不可用**：PLANNED 卡 INV-HARNESS-006 锁定 / DRAFT checkpoint 限 card+lock / READY 后 backlog forbidden。产品卡措辞对齐靠闸门决策，不尝试 amend。（本批独立卡不涉及。）
10. **RLS 容器偶发启动失败**（postgres did not become ready）→ 重试即 PASS。

---

## 7. 已知风险 / 技术约束（延续卡）

- **TASK-0090**：provider_attempt 表 V1–V14 不存在需新建（database-migration C4）；finalize 需 `generation_candidate` 已存在但全仓无 INSERT 入口（须补候选落库或改契约）；append_realtime_event 拒绝终态 generation（终态 realtime_event 必须由 finalize/专用函数原子写，INV-TX-001）；`OwnershipTuple` String↔DB bigint 映射。
- **TASK-0091**：V4 `provider_deployment` INSERT/UPDATE 仅授权 `vc_job_coordinator`，运行期连接角色需匹配；modelruntime 不依赖 persistence（DB 同步只能在 runtime/persistence 层）；runtime 默认无 DataSource（DataSourceAutoConfiguration 被排除，唯一 DataSource 由 auth 门控）——条件化接线不能破坏 `RuntimeContextTest`/`ApprovedModelProviderConfigTest`/`ApprovedModelProviderDisabledTest` 的无 DB 上下文。
- **TASK-0092**：后端 resume_stream 无 out_next_epoch 列（nextEpoch 兜底 `epoch+1` 如实记录）；realtime-contract h5Security 偏好 HttpOnly cookie 但 TASK-0034 用 Bearer+localStorage（本卡沿用 Bearer，不做 cookie 迁移）；后端 ticket/SSE HTTP 端点由 TASK-0090 交付，0092 必须排在 0090 之后。
- **QuotaLedger 仍 in-memory**：0090 需把它接到真实 `quota_ledger_entry`（SETTLE/RELEASE）。
- **LiveModelInvoker 无生产调用入口**：0090 的核心任务。

---

## 8. 下一步动作（推荐）

1. 会话恢复：读 `.harness/` + `doctor.py --summary`（先移 `.serena/`）。
2. 读 `docs/planning/TASK-0090-outbound-lifecycle-wiring.md` 全文，对 TASK-0090 做 intake 预研（确认范围/surface/split 评估）。
3. 按 §3 流程 intake TASK-0090（独立 DRAFT）→ READY → IN_PROGRESS → 实现 → 验证 → R1 → 闭包 → push。
4. 完成 0090 后做 TASK-0091，再 TASK-0092。

**设计文档**：`docs/planning/TASK-0090-outbound-lifecycle-wiring.md`、`docs/planning/TASK-0091-provider-deployment-persistence.md`、`docs/planning/TASK-0092-h5-auth-transport-completion.md`（均为待审阅设计，执行时按实际 intake 细化）。

**相关记忆/参考**：`C:\Users\k\.claude\projects\G--ai-hxf\memory\`（task0036-accepted-status.md、longline-execution-progress-20260806.md、virtual-companion-harness-architecture.md）。
