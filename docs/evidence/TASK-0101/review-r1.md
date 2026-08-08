# TASK-0101 R1 独立复核报告

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit: `f2f5044c134f798d65b2220bbf13dcd37affb90d`（候选实现）
- Base: `0a70e9425e85da6f20ed5aac55200a63d0996d50`
- Verdict: **PASS**（无 P0/P1/P2 阻塞；1×P2 非阻塞建议 + 2×P3 可选）

## 逐项核对

1. **Diff Scope — PASS**：diff 文件集（卡、context lock、run-rls-tests.sh、ci.yml、project-state）全部落在 writeAllowlist 内；未触碰 forbiddenPaths；工作树干净。
2. **卡片状态机 — PASS**：state=IN_PROGRESS；baseCommit/authorizationCommit 可解析且链完整（DRAFT 939ce14 → READY 4930280 → bind 13661d7 → IN_PROGRESS 2558a42 → 候选 f2f5044）；contextFingerprint 独立重算一致（4023739d…）；humanApprovals 非空且覆盖 task-assignment + harness-change。
3. **P2-28 实现 — PASS**：readiness 不再用 pg_isready，改为连续 SQL 探针（-d vc SELECT 1）+ 失败清零 + 200×0.5s 预算；失败打印容器日志并 exit 3；迁移重试只对 6 个已识别启动连接错误模式且每文件 ≤3 次；其他失败立即传播；set -euo pipefail + ON_ERROR_STOP=1 保持；测试循环 PASS/FAIL 语义保持；$VC_DB_LOG_DIR 日志保留（readiness/migration/tests）。
4. **P1-10 实现 — PASS**：database job 复用 run-rls-tests.sh 单一入口（零复制 runner 逻辑）；digest 由脚本冻结保证一致；失败非零退出阻断合并；if: failure() + upload-artifact + if-no-files-found: ignore；无凭据；YAML 可解析（受控 venv PyYAML 实测）。
5. **范围克制 — PASS**：P2-23/P2-26/P2-27/P3-07 均未顺手修；无删测、无 skip、无吞退出码；git diff --check 通过。
6. **验收覆盖 — PASS**：验收 1/2/4/5 实现逻辑可支撑；验收 3（连续 ≥3 轮首轮实测）由实现者定向验证证据支撑。

## Findings

- **P2（非阻塞，已采纳进 fix batch）**：`infra/db/run-rls-tests.sh` 迁移重试 grep 大小写敏感，6 个模式中 3 个与 PG18 真实 libpq/psql 输出不匹配（"Connection refused" 大写 / "connection to server was lost" 小写 / "could not connect to server" 非 psql 消息）。建议 `grep -Ei`。影响有限（未匹配项 fail-closed），但采纳可对齐 P2-28 语义。
- **P3-1（已采纳）**：迁移最终失败路径统一 exit 1，未传播 psql 原退出码；建议捕获真实退出码。
- **P3-2（未采纳，行为正确）**：readiness 探针首轮全成功时 readiness.log 不创建，CI 依赖 if-no-files-found: ignore 兜底，当前行为正确。
