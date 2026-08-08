# TASK-0101 R2 delta 复核报告（fix batch closure）

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit（最终）: `32a8304177e7ff106a36073ddd7e9373063ea93f`（fix batch，amend 后）
- Delta: `f2f5044c…` → `32a83041…`（仅 infra/db/run-rls-tests.sh 14 行；卡片正文回滚到 READY 冻结文本）
- Verdict: **PASS**（P0-1 关闭，无新 P0/P1/P2/P3）

## 过程

R1 复核后采纳 P2+P3-1 进 fix batch（f9569d2 → amend 671110f）。R2 delta 复核发现 **P0-1**：
`migrate_rc=$?` 位于 `if docker exec psql …; then …; fi` 复合语句之后捕获——bash 语义下条件为假且无 else 时整个 if 语句退出码为 0，导致两条失败路径 `exit "$migrate_rc"` 恒 exit 0（失败被吞成成功，fail-open 回归）。已实证（bash 3.2.57 同构模拟：psql 等价命令返回 7 时脚本 exit 0）。

**P0-1 修正（提交 671110f → amend 32a8304）**：`migrate_rc=$?` 移入 `else` 分支内捕获（else 内 $? 即条件命令退出码）；两条失败路径均 `exit "$migrate_rc"`；卡片正文回滚到 READY 冻结文本（doctor 拦截 READY 后正文变更：authorization projection changed）。

## closure 核对（32a8304）

1. delta 只含 run-rls-tests.sh（14 行）；卡片正文与 READY 冻结文本逐字节一致（blob hash 证实）；脚本与 R2 首次复核的 671110f 逐字节一致（blob `2e4825c7…` 相同）——全部语义实证直接成立。
2. else 分支捕获正确：未识别错误路径 migrate_rc=7 → exit 7；重试耗尽路径 exit 7；两条路径均可达。
3. 成功路径 break 不受影响；`grep -Eiq` 6 模式逐字节保留，fail-closed 语义不变。
4. 无变量未定义、无吞退出码、无加 skip；bash -n 通过。
5. P0-1 原缺陷（if 后捕获 $? 恒 0）已彻底修复；R2 首次复核的 P2-1（卡片声明与实现不一致）随正文回滚自然消除。

## 结论

PASS——P0-1 closure 确认，无新 finding。实现者另以冻结 runner 全新容器实测 50/50 PASS（round 6，脚本内容与 32a8304 逐字节一致，sha256 772830e9…）为验收 3 提供运行证据。
