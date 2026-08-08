# TASK-0106：Frontend CI 门禁与依赖安全（P2-19 + P2-18）

```yaml
taskId: TASK-0106
state: ACCEPTED
terminalStateReason: >-
  P2-19+P2-18 完成并验证：ci.yml frontend job 增加 test:run/type-check 门禁
  （不改触发/权限/其他 job）；chat/auth/memory 3 页面组件 glue 测试（真实
  挂载 .vue，vitest 138/138）；依赖完整升级——pnpm-workspace overrides 修复
  intlify/adm-zip/postcss/nanoid/esbuild/qs/cookie/send/body-parser/
  brace-expansion/path-to-regexp/@babel/core，audit 11h/18m/7l → 2h/12m/2l
  （critical 0），例外台账覆盖 vite 5.2.8（uni-app 精确锁定）与
  vue-template-compiler 2.7.16（无 v2 修复），到期日 2026-11-09。type-check
  PASS；uni build PASS；canonical precheck 5/5 PASS（doctor 457972 checks）；
  R1 FAIL（happy-dom 17.4.4 引入 1 critical+2 high → fix batch 20.11.2）+
  R2 delta PASS；链因卡片契约纠正（riskClass C4 + harness-change approval
  scope）reset 重建，重建候选实现树与复核树逐字节一致；remote CI 因 Actions
  配额耗尽如实记录非 PASS（UNKNOWN_NOT_RUN，passClaimed=false），本地等价
  验证为备用通道（Owner 既有授权）。
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
baseCommit: 950162c94a008bf741c48cf55e0d57374d1c8b62
authorizationCommit: "cd0127d0a62f32531ee8f47f131c506e0209370e"
contextFingerprint: 5ad5eb3687e94dd07e17a62270ed4cabbccc7ddd8a53ff9f8e65cc9f42f4e5ae
contextLock: docs/tasks/context/TASK-0106.context-lock.yaml
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
  surfaceId: TASK_0106_FRONTEND_CI_DEPS
  policySurfaces: [AUTHORIZATION, GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 100
  thresholdsTriggered:
    - estimatedWallMinutesGreaterThan: 90
  splitRequired: false
  ownerIndivisibleAuthorization: true
  ownerIndivisibleAuthorizationEvidence: >-
    Owner 2026-08-09 在拆卡决策中明确选择"拆两张"：TASK-0105 前端
    memory/a11y + TASK-0106（P2-19 CI 门禁 + P2-18 依赖完整升级，含 C4
    workflow）；该组合为 Owner 建议的"CI 门禁/依赖卡"，估算超 90 分钟由
    Owner 显式接受，不再拆分。
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
  - docs/tasks/TASK-0105-frontend-memory-a11y.md
  - docs/handoffs/TASK-0105.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - .github/workflows/ci.yml
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/vitest.config.ts
  - frontend/vite.config.ts
  - frontend/tsconfig.json
  - frontend/src/api/auth.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/transport.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/memory.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/memory/memory.vue
  - frontend/src/domain/stream-reducer.ts
writeAllowlist:
  - docs/tasks/TASK-0106-frontend-ci-deps.md
  - docs/tasks/context/TASK-0106.context-lock.yaml
  - .github/workflows/ci.yml
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/pnpm-workspace.yaml
  - frontend/vitest.config.ts
  - frontend/src/pages/memory/memory.spec.ts
  - frontend/src/pages/login/login.spec.ts
  - frontend/src/pages/chat/chat.spec.ts
  - docs/dependency-audit-exceptions.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0106/**
  - docs/handoffs/TASK-0106.json
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0105-frontend-memory-a11y.md
  - docs/evidence/TASK-0105/**
  - docs/handoffs/TASK-0105.json
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
  - infra/**
  - frontend/src/main.ts
  - frontend/src/App.vue
  - frontend/src/domain/**
  - frontend/src/api/**
  - frontend/src/stores/**
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/index/**
  - frontend/vite.config.ts
  - frontend/tsconfig*.json
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
  - docs/tasks/TASK-0105-frontend-memory-a11y.md
  - docs/handoffs/TASK-0105.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: zcode-audit-fix-20260809
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 11 拆卡决策分配 TASK-0106（工作包 11
      第二张）：P2-19 前端 CI 门禁（.github/workflows/ci.yml 加 test:run /
      type-check / build + chat/auth/memory 组件 glue 测试）+ P2-18 前端依赖
      完整升级（uni-app/vite 传递链，Owner 2026-08-09 明确选择"尝试完整升级"，
      以 build+type-check+test 全绿为准，失败回退，不可升级项建立含
      owner/理由/到期日的例外台账）。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: zcode-audit-fix-20260809
    evidence: >-
      .github/workflows/ci.yml 为 C4 保护路径（harness-change + humanApproval +
      独立 Reviewer）。Owner 在 2026-08-08 交接与 2026-08-09 拆卡决策中显式
      批准本卡修改 frontend CI job（P2-19）：在现有 frozen install + build
      基础上增加 pnpm test:run 与 pnpm type-check 门禁步骤，并纳入新增组件
      glue 测试；不改 harness-full/harness-smoke/backend/database job 语义，
      不触碰 workflow 触发条件与 permissions 最小化。
independentReview: required
reviewers:
  - id: task0106_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 55fb6d54d802c21aa481f618814cb232b6a2162c
    evidencePath: docs/evidence/TASK-0106/review-r1.md
    reason: >-
      R1 完整矩阵复核：overrides 真实性/审计计数/ci.yml 门禁/组件测试/既有
      用例均 PASS；发现 1×P1 阻塞（happy-dom 17.4.4 引入 1 critical + 2
      high 且未入台账，计数声明失实）+ 1×P2 说明；P1 采纳进 fix batch
      （happy-dom 20.11.2），R2 关闭。复核树与最终候选 6505060 逐字节一致。
    candidateTree: b4ef5be8672e5c4606720d770e40878c5428d9ca
  - id: task0106_r2
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 078774b124f349cd986955b763162daba1e8f7b9
    evidencePath: docs/evidence/TASK-0106/review-r2.md
    reason: >-
      R2 delta 复核 PASS：happy-dom 20.11.2 清除 critical+2 high（P1 关闭）；
      audit 2h/12m/2l 与例外台账逐字一致；vitest 138/138 + type-check exit
      0；lockfile delta 限于 happy-dom 子树；无新 finding。
    candidateTree: 6e9ca8f453e2519ebe959d5eadd9a85e44c45839
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0106
  - pnpm --dir frontend test:run
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0105 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用。C4 路径仅 `.github/workflows/ci.yml`（harness-change 1.1.7 + humanApproval 已预填 + 独立 Reviewer）；依赖变更写路径 frontend/package.json + pnpm-lock.yaml + vitest.config.ts 已由 Owner 拆卡决策与 P2-18 范围决策授权。

## 背景与用户可观察目标

审计确认前端两个缺陷：

1. **P2-19**：`.github/workflows/ci.yml` frontend job 只做 frozen install + build——已有 Vitest（128 用例）与 vue-tsc type-check 完全不在 CI 门禁内，且 `.vue` 页面 transport glue（chat/auth/memory 页面）无组件/浏览器级测试覆盖（TASK-0104/0105 已知的页面薄胶水风险点）。
2. **P2-18**：2026-08-09 当日 `pnpm audit`：**11 high / 18 moderate / 7 low**（critical 0）。主要实例与锁定链关系（已核实 lockfile）：
   - `vite@5.2.8`（direct）——被 `@dcloudio/vite-plugin-uni@3.0.0-5010520260709002` **精确 peer 锁定**（peerDependencies: vite: 5.2.8）；**最新 uni-app vue3 线 3.0.0-5020320260806002 仍精确锁定 vite 5.2.8**（2026-08-09 实测）→ vite 系列 advisory（11 moderate/low + 2 high 中 GHSA-fx2h-pf6j-xcff 仅 6.4.3+ 修复）在 uni-app 锁定链内**不可升级**，攻击面为本地 dev server/build 工具链；
   - `@intlify/core-base@9.1.9` / `message-resolver@9.1.9` 等 9.1.9 家族——被 `@dcloudio/uni-cli-shared` 精确锁定；high advisory GHSA-p2ph-7g93-hw3m（prototype pollution）修复版 9.1.11；vue-i18n@9.14.5（direct）用的 9.14.5 拷贝已修复；
   - `adm-zip@0.5.16`——被 uni-cli-shared 精确锁定；high advisory（crafted ZIP 4GB 分配）修复版 0.6.0；
   - `postcss@8.5.6`——被 `@dcloudio/uni-nvue-styler` 精确锁定；修复版 8.5.23+（树内已有 8.5.24 拷贝）；
   - `nanoid@3.3.16`——postcss 的依赖；修复版 3.3.17+；
   - `esbuild@0.20.1/0.20.2`——vite 5.2.8 传递链；修复版 0.24.3+（dev server 攻击面）；
   - `path-to-regexp@0.1.10`、`qs@6.11.0/6.13.0`、`body-parser@1.20.3`、`cookie@0.6.0`、`send@0.18.0`、`brace-expansion@2.1.3`、`@babel/core@7.25.2`、`vue-template-compiler@2.7.16`——dev 工具链传递依赖（express/glob/babel 链）。

本卡完成后，用户能观察到：CI frontend job 真实运行全部前端测试（vitest 128+ 组件用例）与 type-check，失败阻断合并；前端依赖树中可升级漏洞被修复（audit 计数下降），不可升级项有带 owner/理由/到期日的例外台账。

## 范围内

- **P2-18 依赖修复（`frontend/pnpm-workspace.yaml` overrides + `frontend/pnpm-lock.yaml`）**：
  1. pnpm 11 实测忽略 package.json 的 `overrides` 字段（2026-08-09 验证：删除锁文件全量重解析仍不生效）——修复版强制项写入 `frontend/pnpm-workspace.yaml` 的 `overrides:`（pnpm 10+ 首选位置，保留 allowBuilds 既有配置）；`frontend/package.json` 不保留无效 overrides。逐项强制修复版（构建/测试失败即回退该项并记入例外台账）：
     - `@intlify/core-base@9.1.9` → 9.14.5（同时关闭 high GHSA-p2ph-7g93-hw3m 与 moderate GHSA-x8qp-wqqm-57ph；9.14.5 家族已在树内由 vue-i18n 使用）；
     - `@intlify/message-resolver@9.1.9`/`@intlify/message-resolver@9.1.10` → 9.1.11（high 修复；9.1.x 家族非 lockstep 发布，仅 core-base/message-resolver 有 9.1.11，其余 9.1.9/9.1.10 家族成员无漏洞 advisory 不覆盖）；
     - `adm-zip@0.5.16` → 0.6.0（high 修复，尝试；API 不兼容则回退记例外）；
     - `postcss@8.5.6` → 8.5.24（patch 级，树内已有同版本）；
     - `nanoid@3` → 3.3.17（patch 级）；
     - `path-to-regexp@0.1.10` → 0.1.13（ReDoS 修复）；
     - `qs@6` → 6.15.2（DoS 修复）；
     - `body-parser@1.20.3` → 1.20.6；`cookie@0.6.0` → 0.7.0；`send@0.18.0` → 0.19.0；`brace-expansion@2.1.3` → 2.1.4；`@babel/core@7.25.2` → 7.29.7；
     - `esbuild@0.20.1`/`esbuild@0.20.2` → 0.25.0（advisory patched 版本 0.24.3 从未发布，0.25.0 为实际修复线；vite 5.2.8 的 esbuild transform API 兼容性验证，失败回退记例外）；
  2. 升级后运行 `pnpm install` 重生成锁文件 → `pnpm audit` 复跑记录新计数（基线 11 high/18 moderate/7 low）；仅保留真实修复项。
  3. 新增 **`docs/dependency-audit-exceptions.yaml`** 例外台账：`vite@5.2.8`（uni-app peer 精确锁定，dev-server/build 工具链攻击面，到期日=uni-app 支持新 vite 的版本发布后复审）、`vue-template-compiler@2.7.16`（v2 无修复版，advisory 要求升 v3 不可行）、以及任何 override 回退项；每项含 package、version、advisory ID、severity、attackSurface、owner、reason、expiryDate。
- **P2-19 CI 门禁（`.github/workflows/ci.yml`，仅 frontend job）**：
  - frontend job 在 install 后增加 `pnpm --dir frontend test:run` 与 `pnpm --dir frontend type-check` 步骤，随后 build；不改触发条件、permissions、其他 job。
- **P2-19 组件 glue 测试（新 devDeps + vitest 配置 + 三个页面 spec）**：
  - `frontend/package.json` devDependencies 新增：`@vue/test-utils`（^2.4）、`happy-dom`（组件测试环境）、`@vitejs/plugin-vue@5.2.4`（树内已有版本，vite 5.2.8 兼容）；
  - `frontend/vitest.config.ts`：注册 @vitejs/plugin-vue；全局保持 environment: node（既有纯逻辑测试不受影响），组件 spec 用文件头 `// @vitest-environment happy-dom`；
  - 新增 `frontend/src/pages/memory/memory.spec.ts`：挂载 memory.vue——错误区 role="alert" 渲染；evidence 空数组不渲染容器 / 有数据渲染（hasEvidence）；保存失败（store.update mock false）保持编辑态、成功退出编辑；busy 时刷新按钮 aria-busy；
  - 新增 `frontend/src/pages/login/login.spec.ts`：挂载 login.vue——输入框 aria-label 存在；提交失败后错误区 role="alert" 出现且焦点回到用户名输入（document.activeElement）；submitting 时按钮 aria-busy；
  - 新增 `frontend/src/pages/chat/chat.spec.ts`：挂载 chat.vue——状态区 role="status"+aria-live="polite"；流失败（fetch stub reject）→ 显示"恢复失败，请重试"；取消按钮 aria-busy 绑定 isStreaming；不触碰 store/domain 实现（只读复用）。
- **测试**：既有 128 用例保持全绿（无删测、无 skip）；新增组件用例并入 vitest 计数。

## 明确范围外

- 不改 harness-full/harness-smoke/backend/database job、workflow 触发条件、permissions、actions 版本（P2-23 范围）、ci-execution-policy.yaml（C4 机器真源，P2-21/27 范围）。
- 不升级 uni-app 主版本（3.0.0-5010520260709002 → 其他大版本线）——2026-08-09 实测最新 vue3 线仍锁 vite 5.2.8，升级无收益且高破坏风险；该项由例外台账记录。
- 不触碰前端业务源码（frontend/src/api/**、stores/**、*.vue 只读）；不修后端；不改 TASK-0105 交付物。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。
- P2-23（Actions 固定 SHA）、P2-24（harness Python hash lock）、P2-25（SBOM/license 扫描）不在本卡（工作包 15）。

## 输入和前置条件

- Base Commit 固定为 `950162c94a008bf741c48cf55e0d57374d1c8b62`（TASK-0105 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0106 条目。
- 依赖调研已实测（2026-08-09）：uni-app vue3 最新线 3.0.0-5020320260806002 仍 peer 锁定 vite 5.2.8；树内已有 postcss 8.5.24 / @vitejs/plugin-vue 5.2.4 / esbuild 0.28.1 等修复版拷贝。
- 前端验证：`pnpm --dir frontend test:run` + `pnpm --dir frontend type-check` + `pnpm --dir frontend build`；`pnpm --dir frontend install`（升级后重生成锁文件）；本机 pnpm 10.32.1 / node v22.23.1。
- Canonical argv 保持 `python`（受控 venv `~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀）；每次 doctor/precheck 干净 `TMPDIR=$(mktemp -d ...)`。
- C4 路径 `.github/workflows/ci.yml`：harness-change 1.1.7（已注册版本）+ humanApproval（已预填）+ 独立 Reviewer；改动只限 frontend job 步骤。

## API / 事件 / 数据契约

- 无 API/事件/数据契约变更；纯前端工具链与 CI 门禁。
- `package.json`：devDependencies 新增 @vue/test-utils / happy-dom / @vitejs/plugin-vue；`overrides` 字段新增修复版强制项（pnpm 10/11 均支持）。
- `pnpm-lock.yaml`：由 `pnpm install` 重生成（overrides 生效后受影响包版本更新）。
- `vitest.config.ts`：plugins 增加 @vitejs/plugin-vue；test.environment 保持 node，组件 spec 文件头声明 happy-dom。
- `ci.yml` frontend job：install → test:run → type-check → build（步骤顺序可微调，门禁语义不变）。
- 新增 `docs/dependency-audit-exceptions.yaml`：结构化例外台账（schemaVersion + entries）。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据/凭据；组件测试为合成 fixture，全部 stub。
- 依赖升级仅影响开发/构建工具链与 lockfile；不引入新运行时依赖（devDependencies 只新增测试基建）。
- 不向日志/仓库写入任何凭据。

## 状态机和失败行为

- 依赖升级：逐项 override → `pnpm install` → `pnpm audit` 复跑；audit 计数较基线（11 high/18 moderate/7 low）下降即证明修复；构建/测试失败项回退 override 并记入例外台账（不回退整卡）。
- CI 门禁：workflow 步骤失败即 job 失败（真实退出码传播，不吞）。
- 组件测试：happy-dom 环境渲染失败/断言失败即用例失败（非零退出）。
- 任一测试失败保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095..0105 先例），本地等价验证（vitest + type-check + build + canonical precheck）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆、SafetyGate；不引入 SaaS 或付费运行时。
- INV-TENANT-001 保持（组件测试断言存在性隐藏文案不披露资源存在性）。
- 依赖审计例外台账是安全治理产物，不弱化任何失败关闭语义。

## 验收标准

1. **P2-18 计数下降**：升级后 `pnpm audit`（当日复跑）较基线 11 high/18 moderate/7 low 有真实下降；high 项中除例外台账记录项外全部关闭（@intlify 9.1.11、adm-zip 0.6.0 若可、postcss/nanoid/qs/cookie/send/body-parser/brace-expansion/path-to-regexp/@babel/core 修复项落地）。
2. **P2-18 例外台账**：`docs/dependency-audit-exceptions.yaml` 含每项 package/version/advisory ID/severity/attackSurface/owner/reason/expiryDate；vite 5.2.8 与 vue-template-compiler 2.7.16 必在台账（uni 锁定链/无修复版，理由与到期日明确）。
3. **P2-18 构建保真**：升级后 `pnpm --dir frontend install`（锁文件一致）、test:run 全 PASS、type-check PASS、uni build PASS；任一失败项回退并记例外，不得留下红链。
4. **P2-19 CI 门禁**：ci.yml frontend job 含 test:run 与 type-check 步骤（步骤存在即验收；真实远端执行受 Actions 配额限制，remote 如实记录非 PASS）。
5. **P2-19 组件 glue**：三个页面 spec（memory/login/chat）真实挂载 .vue 并断言——memory：错误 role=alert、空证据不渲染容器、保存失败保持编辑态；login：aria-label、失败后 role=alert + 焦点回用户名、submitting aria-busy；chat：状态区 role=status+aria-live、fetch 失败→"恢复失败，请重试"、取消按钮 aria-busy。
6. **既有用例保持**：原 128 用例全绿（无删测、无 skip）。
7. **前端验证**：`pnpm --dir frontend test:run` 全 PASS（含新组件用例）；type-check PASS；build PASS；canonical precheck 5/5 PASS。
8. **交付闭环**：Diff 仅含 writeAllowlist；独立 Reviewer 通过（C4 workflow 变更）；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`pnpm --dir frontend test:run` 是任务特有前端门禁（precheck 不含前端），只运行一次；`git diff --check` 只运行一次。type-check/build/audit 作为定向验证记录。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/环境身份。

## 回滚或前向修复

- 依赖升级逐项可回退：某项 override 导致 build/test 失败 → 移除该项 override → `pnpm install` → 该项记入例外台账 → 继续其余项。
- 组件测试失败 → 修正测试或（若揭示页面缺陷）按 writeAllowlist 修复页面文件前先停下评估（页面 .vue 为 read-only，若必须修改则先停止并询问 Owner 扩写路径）。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 .vue 页面源码、stores/api 源码、ci-execution-policy.yaml、其他 workflow job 语义、触发条件）时立即停止并询问 Owner。
- 依赖升级揭示 uni-app 工具链硬不兼容（如 uni build 无法在新锁下工作且回退也失败）时停止并报告。
- 组件测试揭示页面真实缺陷需改页面源码时停止并询问（页面源码本卡只读）。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0106/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0106.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、解释器/环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。audit 基线/复跑计数与例外台账
内容必须进入 Evidence 记录。
