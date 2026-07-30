# TASK-0009 Windows Harness CI 超时裕量独立复核

```yaml
taskId: TASK-0009
reviewerId: codex-task0009-ci-reviewer
kind: ci-harness-timeout-budget
verdict: PASS
reviewedCommit: a178e8fb6c3ba05e4c06469fc83f9c553d97ec65
reviewedTree: 4ce5e06adab7b7761b90dfc143167ac67ab6a543
```

## 结论

PASS，无阻断项或非阻断遗留项。Reviewer 未参与实现，未修改、暂存、提交或推送文件，并将结论绑定到精确实现提交及其 Git Tree。

## 范围与不变边界

- Implementation Commit 只修改 `.github/workflows/ci.yml` 与 `scripts/harness/tests/test_harness.py`。
- Backend、Frontend、Workflow 权限和 Harness 原步骤对象经结构化比较完全一致；`service/**` 与 `frontend/**` 零差异。
- Harness matrix 恰好包含 Ubuntu、Windows、macOS；预算分别为 10、20、10 分钟。
- 新自动测试同时锁定 `fail-fast: false`、Runner、逐 OS 预算和原有六个步骤的名称及顺序。
- 没有删除、跳过、拆弱或吞掉任何 Harness、Doctor、Catalog、付费依赖或 Beta Gate。

## 独立复验

- Base `8e5e7aa5a8b2f245b804be058c799826d81fd74c`、精确实现 Commit 与 Git Tree、祖先关系：PASS。
- `git diff --check 8e5e7aa5a8b2f245b804be058c799826d81fd74c a178e8fb6c3ba05e4c06469fc83f9c553d97ec65`：PASS。
- 定向 CI workflow 自动测试：PASS，1/1。
- 完整 Harness：PASS，70 项，耗时 761.706 秒，按 Windows 条件跳过 1 项。
- `doctor.py --task TASK-0009`：PASS，共 22,006 项检查。
- Catalog validate 与 drift：PASS。
- GitHub Actions Run `30510419359` 精确绑定实现 Commit，Backend、Frontend、Ubuntu/Windows/macOS Harness 五作业全部成功。
- Windows Runner 实际完成 70 项 Harness 测试，耗时 637.814 秒，结果 `OK (skipped=1)`。
- Windows Runner 随后实际完成 canonical PowerShell precheck；Doctor 22,006 项、Catalog validate、Catalog drift 与 5 条 precheck 命令全部 PASS。

## 根因证据

- TASK-0008 精确实现 Run `30505196389` 的两次 Windows 作业均在约十分钟处被取消。
- 首次运行的既有 69 项 Harness 测试已经成功，取消发生在 canonical precheck；第二次在相同总作业上限内来不及完成测试。
- TASK-0009 没有改变测试或门禁语义；17 分 35 秒的成功作业证明原 10 分钟预算不足，20 分钟预算保留约 2 分 25 秒明确余量。

## 明确未运行边界

- `NOT_RUN`：真实 Provider、模型、网络、API Key、区域、合同准入或线上部署。
- `NOT_RUN`：OpenAI/Anthropic HTTP/SSE Adapter、Runtime、前端业务、数据库、支付或 Beta。
- Reviewer 未重复运行独立 PowerShell 与 WSL precheck 包装器；主 Agent 已在精确实现快照上分别运行并记录。
