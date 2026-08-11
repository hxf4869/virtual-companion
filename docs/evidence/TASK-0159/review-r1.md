# TASK-0159 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核时间**：2026-08-11..2026-08-12
- **候选**：`061e370933a285117d1b459e75e6d0305fd7d994`（tree `80c334c795c60e7b70b833741f6b5b4fac70913a`），单父 86c31c1，工作树 clean
- **Base**：`b748daf162527e129969d00a217ed05fb264a537`（TASK-0155 REJECTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `061e370…` | `git rev-parse HEAD` = 061e370… | PASS |
| 候选 Tree | `80c334c…` | `git rev-parse 061e370^{tree}` = 80c334c… | PASS |
| Base | `b748daf…` | b748daf 是 061e370 祖先 | PASS |
| 提交链 | 8afa800 DRAFT → 58bf69d READY → 079d016 authorizationCommit → 86c31c1 IN_PROGRESS → 061e370 候选 | 每提交单父，线性无 merge | PASS |
| contextFingerprint | `84c08c8fa209b9984cc21325d91f97803f405a78f9dc5b7a12b7d6d76f0146e9` | 独立复算完全匹配（矩阵 B） | PASS |

## 独立运行结果

| # | 命令 | 退出码 | 结果 | 关键输出 / checks | 耗时 |
|---|------|--------|------|-------------------|------|
| 1 | `git diff --check b748daf..061e370` | 0 | **PASS** | 输出空 | 0.023s |
| 2 | `python scripts/harness/doctor.py --task TASK-0159` | 0 | **PASS** | 734850 checks | 91.55s |
| 3 | `python scripts/harness/precheck.py --task TASK-0159`（canonical） | 0 | **PASS 8/8** | `License inventory check: PASS (71 direct dependencies, 15 pom files)`；`Harness precheck: PASS (8 commands)` | 1.51s |
| 4 | `python scripts/harness/tests/test_harness.py` | 0 | **PASS** | `Ran 261 tests across 27 classes with 10 workers` / `OK` | 1034.41s |

CMD 4 说明：输出可见 `doctor: FAIL ... task-lifecycle.yaml: cannot load YAML`，这是 test_harness.py 内**隔离临时仓库**夹具测试 doctor 错误处理的预期输出（任务背景已预警），非真实失败；最终 `Ran 261 tests … OK` 且进程退出码 0。

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：writeAllowlist 与 forbiddenPaths 两块在 DRAFT(8afa800)/READY(58bf69d)/候选(061e370)三提交字节级一致（合并 sha256 `5798cf79…`）。`git diff --name-status b748daf..061e370` 仅 4 文件：`M .harness/license-inventory.yaml`、`M .harness/project-state.yaml`、`A docs/tasks/TASK-0159-*.md`、`A docs/tasks/context/TASK-0159.context-lock.yaml`，全部在 writeAllowlist 内；实现提交 061e370 单独只动 license-inventory（+3 行）。逐提交 diff 验证：每个提交全部改动均在 writeAllowlist 内，**零** forbiddenPaths 触碰（`service/apps/**`、其他 `.harness/*` 治理文件、`scripts/harness/**`、`skills/**`、`pom.xml`、`ci/**`、`.github/**`、`specs/**`、`docs/schemas/**` 全部未动）。Diff scope 按 Base 后每条父边累计合规，无 merge 旁路、路径别名或追溯授权。

**B. context fingerprint（PASS）**：按 `harness_common.py verify_context_lock` 语义独立复算（纯自写脚本）：45 inputs（44 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1…`）；其余 44 条对 `git cat-file -p b748daf:path` 取字节 sha256，与 lock 声明逐一比对——**0 个 hash mismatch**；按 logical path 排序，`"\n".join(f"{path}={digest}")` 无尾换行（payload 长度 4820），再 sha256 = `84c08c8fa209b9984cc21325d91f97803f405a78f9dc5b7a12b7d6d76f0146e9`，与卡/锁声明**完全一致**。

**C. 技术复核（PASS）**：
- `.harness/license-inventory.yaml`：新增条目 `- groupId: org.springframework.boot / artifactId: spring-boot-starter-flyway / licenseFamily: Apache-2.0`，格式与既有 spring-boot-starter-actuator/jdbc/security/test/validation/webmvc 完全一致；位置在 starters 段（security 之后、test 之前），合理。未改 license-policy.yaml allowlist（Apache-2.0 已允许）、未改 check_licenses.py、未改 ci.yml、未改 exceptions/frontend 段。
- `service/apps/runtime/pom.xml`（Base b748daf 已含）确认含 `<dependency>org.springframework.boot:spring-boot-starter-flyway</dependency>`（无版本，Boot 4.1.0 托管 flyway 12.4.0）→ 本卡不重复实现，writeAllowlist 不含 service/apps/** 且全部 forbidden，合规。
- `check_licenses.py` 逻辑：扫描所有 pom 直接依赖按 (groupId, artifactId) 比对 inventory 且 licenseFamily 须在 allowlist；starter-flyway 现命中 inventory → Apache-2.0 → PASS（实证 71 direct dependencies, 15 pom files）。
- `test_harness.py` 不硬编码 inventory 数量：`test_license_check_passes_on_current_inventory` 直接运行 check_licenses.py 读真实文件 → 加一行不破坏（261 OK 实证）。

**D. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | license-inventory 含 starter-flyway / Apache-2.0，格式一致 | PASS |
| 2 | 唯一 canonical precheck 8/8 PASS（licenseCheck PASS） | PASS |
| 3 | 完整 Harness unittest PASS（261+ tests） | PASS |
| 4 | 唯一无参数 git diff --check PASS（输出空） | PASS |
| 5 | R1 独立复核 PASS（C4 必须；0 P0/P1/P2） | PASS（本报告） |
| 6 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0-0 / clean / remote exact-SHA 如实非 PASS | NOT_RUN（终态范围，R1 后执行） |
| 7 | TASK-0155 实现的 P1-11 行为保持（Base 已含，本卡不改） | PASS（runtime pom 含 starter-flyway；context lock 44 路径 hash 全匹配 Base；service/apps/** 零触碰） |

**E. 不变量（全部满足）**：INV-HARNESS-001（AGENTS.md 单一权威源，未触碰）✓；INV-HARNESS-002（单活动任务 TASK-0159 + 冻结 context + 单父原子）✓；INV-HARNESS-003（protected path `.harness/**` → C4 + harness-change 1.1.7 + Owner humanApproval scope: harness-change + 独立 R1）✓；INV-HARNESS-005（evidence 诚实，未运行项如实 NOT_RUN）✓；INV-HARNESS-007（single-card + bounded review + exact candidate + exact-tree）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen at READY，dispatchCount=0，远端如实非 PASS）✓。

**F. replacement 合规性（PASS）**：TASK-0159 是 TASK-0155 合法 replacement——Base `b748daf` = TASK-0155 REJECTED terminal；TASK-0155 evidence `state: REJECTED`、licenseCheck FAIL reason 明确、R1 FAIL；TASK-0155 handoff 完整记录已完成/剩余/风险并指向 TASK-0159；b748daf 已 push 到 origin/main（byte-for-byte 不可改写）；不重复实现（writeAllowlist 不含 service/apps/**）；Owner 授权链完整（3 个 humanApprovals，approvedAt 2026-08-12，sourceThreadId 与 TASK-0155 沿用一致）。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：`.harness/license-inventory.yaml` 第 9 行头部注释 `# 实际 = 15 外部 + 9 内部模块 = 24` 未更新（加 starter-flyway 后实际 16 外部 + 9 内部 = 25）。check_licenses.py 只读 `mavenDirectDependencies` 列表不读注释，不影响功能（licenseCheck PASS 已实证）。最小 diff 原则下候选只追加数据行属审慎选择；建议未来触及该文件的任务顺手更新注释数字。

## Verdict

**R1 PASS**。TASK-0159 候选 `061e370`/tree `80c334c` 为最小数据行追加（spring-boot-starter-flyway / Apache-2.0 登记入 license-inventory.yaml），完全在 writeAllowlist 内、零 forbiddenPaths 触碰、context fingerprint 独立复算一致、唯一 canonical precheck 8/8 PASS（licenseCheck 从 TASK-0155 的 FAIL 转为 PASS）、完整 Harness unittest 261 OK、git diff --check 干净、protected path C4 全部门槛满足、TASK-0155 replacement 关系合规且历史不可改写。验收 1-5 与 7 PASS，6 属终态范围（NOT_RUN）。可进入终态闭环。
