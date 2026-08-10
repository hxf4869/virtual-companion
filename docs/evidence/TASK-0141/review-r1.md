# TASK-0141 独立 C4 Review R1

```yaml
taskId: TASK-0141
reviewerId: task0141_r1
verdict: PASS
reviewedCommit: d34ff2c16ea95eafe6e463d856d6a1e45c18b43d
candidateTree: c82bb086685aff7325f4ea8977b2864a9e10cd09
baseCommit: 8d613427573915b628d6643bdd78fc0e58227e71
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`；**P1**: `0`；**P2**: `1`；**P3**: `3`（信息性）

无阻断 finding。P2 与 P3 提示：

1. **P2-1 升级流程注释未逐行覆盖全部 uses**：ci.yml 共 11 处 `uses:`，仅两处 harness 任务的
   checkout 附带「升级流程」注释，其余 9 处只有 `# owner/repo@vX -> <40-hex>` 一行；卡内范围
   「每行行内注释标注原 tag 与受审升级流程」字面逐行解释未完全满足。不构成供应链合同破坏（全部
   SHA 已固定且与上游 tag 实测一致）；已在本卡允许的修复批次内补齐（见 R2）。
2. P3-1 README.md 安装示例无 `--require-hashes`（README 是本卡 forbiddenPath，未触碰正确；
   留后续卡统一）。
3. P3-2 根目录 MANIFEST.sha256 的 requirements-harness.txt 条目陈旧（Base 时已陈旧，非本卡
   引入；README 声明其仅证明 V0.3.1 起步包来源）。
4. P3-3 锁合同测试对注释内容的脆弱性提示（`assertNotRegex(content, r">=|<=|~=")` 扫描含注释
   的整个文件，未来注释若含这些字符会误报；当前无实际影响）。

## Acceptance

- **AC1**：ci.yml 全部 11 处 `uses:` 为精确 40-char commit SHA（6 个唯一 SHA，全部经
  `git ls-remote` 与上游 tag 实测一致：checkout v6→d23441a4…、setup-python v6→ece7cb06…、
  setup-java v4→cf277c60…、setup-node v6→24997072…、upload-artifact v4→ea165f8d…、
  pnpm/action-setup v6→0977fd99…）；行内注释含原 tag（P2-1 见上）；两处 harness 安装命令均为
  `python -m pip install --require-hashes -r requirements-harness.txt`。
- **AC2**：requirements-harness.txt 全部依赖行为精确版本 `PyYAML==6.0.3`（21 个 hash：cp312×10
  平台 + cp313×10 平台 + sdist）、`tzdata==2026.3`（wheel + sdist 共 2 个 hash），全部 23 个
  `--hash=sha256:<64hex>` 与 PyPI 实时 digest 一一对应；无 `>=`/`<=`/`~=` 范围约束残留。
- **AC3**：新增 SupplyChainTests（3 个测试：requirements 精确版本+hash、ci.yml uses 为
  owner/repo@40-hex 且注释 tag→SHA 与 uses SHA 一致、安装命令含 --require-hashes），逻辑正确、
  任一违反即断言失败关闭；无删测、无新增 skip（diff 纯新增 85 行）。
- **AC4**：实现提交只改 `.github/workflows/ci.yml`、`requirements-harness.txt`、
  `scripts/harness/tests/test_harness.py` 三个 writeAllowlist 路径；全链文件均在 writeAllowlist，
  无 forbiddenPaths 触碰；未删测、未加 skip、未吞退出码。
- AC5（全新 venv 安装）/AC6（完整 unittest）/AC7（precheck/diff check/远端 0/0）：NOT_RUN，
  Reviewer 按要求未运行正式门禁与完整测试。

## Scope And Identity

候选 Commit `d34ff2c`、Tree `c82bb086…` 与卡声明一致；候选单父 `3293624`（IN_PROGRESS）；
提交链 DRAFT `a7b5de0` → 授权 `304fd0e`（与卡 authorizationCommit 一致）→ 绑定 `6723c46` →
IN_PROGRESS `3293624` → 实现 `d34ff2c`。实现提交仅 3 文件（+141/-15）。INV-HARNESS-001..009
无削弱；AGENTS.md、CLAUDE.md、agent-entrypoints.yaml、precheck.py/.sh/.ps1、commands.yaml、
ci-execution-policy.yaml、skills、ci/README.md 均未触碰。三文件无冲突标记、无尾随空白、LF 行尾、
无 BOM；hash 行格式符合 pip canonical 语法。

## Decision

**PASS。** 无 P0/P1 阻塞项，无 ACCEPTANCE_VIOLATION，无 INVARIANT_VIOLATION。供应链合同
（actions 固定 SHA + 依赖精确版本/hash lock + 失败关闭测试）经独立核对全部成立：六个 actions
SHA 与上游 tag 实测一致、23 个依赖 hash 与 PyPI digest 逐一对应、测试失败关闭语义完备、范围
严格受控。1 项 P2（升级流程注释未逐行覆盖）已按建议在修复批次内统一补齐（见 review-r2.md）。
Reviewer 未运行任何正式门禁；本结论不替代 Precheck / 完整 unittest / diff check / pre-closure /
远端 0/0 的 PASS。
