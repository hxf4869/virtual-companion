# TASK-0152 R1 独立复核

Reviewer：独立 subagent（fork_turns=none，无任务历史上下文，只读）
候选：06f4cef5b5e547caa0cea1f29ef574f9ebdbb054（tree 89d6414069e4a5c0684934d4162220ddff8ca55f），单父 c1c0920，工作树 clean
Base：26131834ce239608116f34cd87ce65a5750310f9（TASK-0150 terminal）
复核时间：2026-08-11

## verdict: PASS

阻塞 P0/P1/P2 为零；前身 TASK-0151 R1 findings 全部闭合。

## R1 finding closure 表（前身 TASK-0151，经 Owner 授权 reset 摘除后重建）

| finding | 等级 | 闭合状态 | 证据 |
|---|---|---|---|
| DRAFT 缺 scope: harness-change humanApproval（P0 根因） | P0 | CLOSED | 任务卡 humanApprovals 含 `scope: harness-change`（approvedBy=repository-owner、approvedAt=2026-08-11 ISO、evidence 非空详述 5 个 C4 protected 路径）；实测 `doctor.py --task TASK-0152` 对候选 PASS（710573 checks，exit 0，无 protected approval 错误） |
| exceptions 到期语义 + 负例 3 场景 | P1a | CLOSED | `exception_is_active`：expiresAt 缺失/非 ISO/<=今天 均报错 FAIL，仅 `> 今天` 生效；3 个负例测试全部存在且实测 PASS（uncovered dependency / disallowed family / expired+malformed+valid-future exception 3 子场景） |
| ci.yml SBOM 上传路径 | P1b | CLOSED | 上传 `path: target/*.json`；cyclonedx-maven-plugin 2.9.1 描述符确认 outputName 默认 outputDirectory=${project.build.directory} → `target/virtual-companion.json`，路径精确匹配 |
| vite/vue-tsc=MIT、24+20 数字、sys.executable、无死代码 | P2 | CLOSED | inventory 中 vite=MIT、vue-tsc=MIT；独立解析确认 24 唯一 Maven（15 外部+9 内部）+ 20 frontend；正例测试用 `subprocess.run([sys.executable,...])`；extract_maven_dependencies 的 managed 集合被正确使用（无死代码） |
| extract_maven_dependencies 清理 | P3 | CLOSED | managed 去重逻辑实用于跳过同 pom dependencyManagement 条目，无未使用变量/空循环 |

## findings（本候选）

### P0
无。

### P1
无。

### P2
无。

### P3（信息性，不阻塞）
1. `actions/setup-java@v4` 上游已弃用声明（v4 不再更新，提示迁移 v5）。本卡 SHA pinned 精确到 v4 tag，合规；仅提示后续卡可评估迁移 v5。
2. `check_licenses.py` 若 license-inventory.yaml 整体缺失会抛 FileNotFoundError（traceback，exit 1），非优雅报错；fail-closed 语义仍成立，负例测试 1 覆盖"清单缺失"语义，与任务卡验收标准 3 措辞一致。

## 复核通过的矩阵项
1. diff 范围合规：base..candidate 8 文件全部命中 writeAllowlist（任务卡、context-lock、project-state、commands.yaml、license-inventory.yaml、check_licenses.py、test_harness.py、ci.yml），零 forbiddenPaths；`git diff --check` 干净。
2. 候选身份：commit 06f4cef / tree 89d64140 / 单父 c1c0920；base 26131834 为祖先；context fingerprint 独立复算 MATCH（3aa7fdd4...dc703，54 条目含 1 条 provenanceOnly）。
3. 验收标准 1：check_licenses.py 存在、可执行、纯 stdlib+PyYAML、实测 exit 0 输出 `License inventory check: PASS (70 direct dependencies, 15 pom files)`。
4. 验收标准 2：precheck profile 恰 8 命令（licenseCheck 第 5 位）、每命令一次；harnessPortabilityLocal 与 base 字节级 diff 为空（仍 6 命令）。
5. 验收标准 3：profile 精确断言 8 命令；licenseCheck 正例 + 3 负例场景（5 个测试实测 OK）；sys.executable。
6. 验收标准 4：ci.yml 仅追加 supply-chain job，现有 5 job 字节未动；5 个 action SHA 全部经 GitHub API 验证与注释 tag 精确一致；上传路径 target/*.json 正确；if-no-files-found: error fail-closed。
7. 验收标准 5：inventory 24 Maven + 20 frontend 全覆盖（独立交叉核对无遗漏）、内部模块 INTERNAL、vite/vue-tsc=MIT。
8. 验收标准 6（终态证据范畴）：diff --check 干净；完整 Harness unittest 实测 261 tests OK（Reviewer 独立运行）；doctor 实测 PASS。
9. INV-COST-001：license_scan 首次落地，纯 Python + Apache-2.0 cyclonedx + 内置 pnpm audit，无付费/SaaS 依赖。
10. INV-HARNESS-001/002/003/004/005/007/009：单活动任务、protected path 精确 skill + humanApproval + independentReview、wrappers 未动、single-card、local-exact-tree-fallback 冻结于 READY 并含 Owner 批准，全部经 doctor PASS 实测确认。
11. 邻近风险：managed 去重正确（当前仓库无 (gid,aid) 同时出现在同 pom 的 dependencies 与 dependencyManagement，唯一依赖恰 24）；exceptions 语义与任务卡一致；cyclonedx 2.9.1 真实存在（Maven Central 验证 makeAggregateBom goal）；licenseCheck 不在 CANONICAL_PRECHECK_COMMANDS（仿 openapi 先例）。

## 修复建议
无阻塞项。可选跟进（非本卡范围）：setup-java v4 上游弃用，后续卡可迁移 v5；check_licenses.py 可对缺失清单文件加友好报错（当前 traceback exit 1 已 fail-closed）。
