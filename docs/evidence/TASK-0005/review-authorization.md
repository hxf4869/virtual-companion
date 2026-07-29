# TASK-0005 Harness 授权独立复核

```yaml
taskId: TASK-0005
reviewerId: codex-task0005-authorization-reviewer
kind: harness-authorization
verdict: FAIL
reviewedCommit: 496b82bb2014a7e6fb093e201d0c8039e8276315
reviewedTree: 0cb7e6ec1c69f41423a6edba0d9aa0e57c997f54
```

## 结论

FAIL，TASK-0005 不应进入 ACCEPTED，应以 REJECTED 终止并由新任务重新形成正确授权。

## 阻断证据

1. `.harness/protected-paths.yaml` 将 `scripts/harness/**` 定义为 C4 受保护路径，要求 `harness-change` Skill、人工审批和独立复核。Doctor 的 `validate_diff_scope` 精确要求审批条目的 `scope` 等于 Skill ID `harness-change`。
2. TASK-0005 的不可变 READY 授权把审批范围记录为 `fix-harness-latest-terminal-task-test-fixture-and-ci`，不满足上述精确值，因此没有权限修改 `scripts/harness/tests/test_harness.py`。
3. reviewedCommit 只把任务从 READY 转为 IN_PROGRESS；目标测试文件的 Blob `3349ab403e3e692239098d93e7f01479edbcae7e` 与父提交及 Base Commit 相同，没有任何 Harness 实现变更。
4. 目标测试仍保留硬编码 `TASK-0002`，已知三平台 CI 失败未在该提交中修复。

## 建议

保持历史不可改写，拒绝 TASK-0005；随后创建新 C4 任务，在 DRAFT/READY 授权中使用精确 `humanApprovals.scope: harness-change`，再实施同一最小夹具修复。
