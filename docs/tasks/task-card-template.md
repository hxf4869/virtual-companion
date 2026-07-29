# TASK-XXXX：标题

```yaml
taskId: TASK-XXXX
state: DRAFT
owner: ""
riskClass: C1
requiredSkills: []
requiredSkillVersions: {}
targetSkillVersions: {}
baseCommit: ""
authorizationCommit: ""
contextFingerprint: ""
contextLock: docs/tasks/context/TASK-XXXX.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist: []
writeAllowlist:
  - docs/tasks/TASK-XXXX-title.md
  - docs/tasks/context/TASK-XXXX.context-lock.yaml
  - docs/evidence/TASK-XXXX/**
  - docs/handoffs/TASK-XXXX.json
forbiddenPaths: []
sourcesOfTruth: []
requiredInvariants: []
humanApprovals: []
independentReview: not-required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-XXXX
  - python scripts/harness/precheck.py --task TASK-XXXX
  - git diff --check
```

## 背景与用户可观察目标

说明用户最终能观察到什么，以及为什么现在要做。

## 范围内

## 明确范围外

## 输入和前置条件

所有 Context Lock 输入必须使用 Base Commit 中的仓库相对路径。外部资料只记录 provenance；需要参与复验时先归档到仓库。

## API / 事件 / 数据契约

## 权限、RLS 和数据处理要求

## 状态机和失败行为

## 模型、Prompt、记忆和安全边界

## 验收标准

每项必须可复测，包含公式、样本、通过线或明确断言。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

## 停止条件

## Evidence Pack

输出到 `docs/evidence/TASK-XXXX/`，并生成 `docs/handoffs/TASK-XXXX.json`。
