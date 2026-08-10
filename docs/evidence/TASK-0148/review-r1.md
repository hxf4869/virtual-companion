# TASK-0148 R1 独立复核

- Reviewer: task0148_r1（独立只读子代理，无本任务历史上下文）
- 审阅候选: commit `06ca59ef59b695090852198fe0885c84cedd342e` / tree `8e27ba8d25f03a417d79c4724349d36202ca80a0`（diff 基 0f99394：仅 audit-matrix.md 核对源表述修正）
- 预算: 15 分钟；耗时 115.4s
- 结论: **VERDICT: PASS**（P0=0、P1=0、P2=0、P3=2 信息性，fix batch 已修正）
- Reviewer 未运行任何正式门禁，如实 NOT_RUN。

## 复核范围

核对矩阵 `docs/evidence/TASK-0148/audit-matrix.md` 声称 README.md 的 16 项可验证声明全部与
代码/配置/OpenAPI/frontend/文件系统事实一致、README 无需修改。抽查 16 项中的 12 项（含全部
重点项），逐项核实 README 行号与对应事实。

## 逐项核对结果

| # | 声明 | 结果 |
|---|---|---|
| 1 | `GET /actuator/health` | 一致（application.yaml include: health） |
| 2 | `GET /api/internal/baseline` | 一致（BaselineController.java:8） |
| 3-6 | auth 四端点 | 一致（AuthController.java:45+69/80/90/99） |
| 7 | 合同面 6 类无 controller | 一致（OpenAPI paths 齐全；全仓库 @RequestMapping 仅 auth/baseline 两处） |
| 8 | 15 模块 reactor | 一致（14 modules + root，项目惯例） |
| 9 | V1-V15 迁移 | 事实一致；矩阵核对源路径写错（fix 已修正为完整路径） |
| 10 | admission limiter | 一致（AuthSourceAdmissionFilter + AuthRateLimitException/Response） |
| 11 | uni-app 技术栈 | 一致（package.json @dcloudio/uni-app、src/pages 齐全） |
| 12 | CI 门禁 | 一致（ci.yml 5 个 job） |
| 13 | profile 开关 | 一致（application.yaml 默认 false + production 强制） |
| 14 | 边界 | 一致（realPayment FORBIDDEN、无注册 controller） |
| 15 | 脚本/文档引用 | 一致（scripts/dev 5 个 .ps1、三份文档存在） |
| 16 | MANIFEST | 声明事实成立；矩阵核对源"头部说明"不实（fix 已改为 commit 历史依据） |

## 发现

- **P0/P1/P2**：无。
- **P3（信息性，2 项，fix batch 已修正）**：
  1. #9 核对源路径写 `db/migration/`，实际在
     `service/platform/persistence/src/main/resources/db/migration/`。
  2. #16 核对源"MANIFEST.sha256 头部说明"不存在（文件为纯哈希行），正确依据是
     `git log -- MANIFEST.sha256` 唯一 commit `85cc739`。

## 总体判断

核对矩阵整体可信：抽查 12 项全部与事实一致，README 行号标注精确，README 在候选 tree 中与
父提交字节相同，"README 无差异、无需修改"的判断成立。两处 P3 仅为矩阵"核对源"列表述瑕疵，
未推翻任何结论。结论 PASS。
