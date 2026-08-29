# 检查与流程设计原则（防过度工程化）

> 本文由 2026-08-16 检查体系重构沉淀而来。那天之前，本仓库日常检查单次耗时 15-25 分钟、
> 治理代码约为产品代码的 3 倍；重构后日常全量检查约 6 秒。写本文的目的不是记录历史，
> 而是给未来任何人（包括 AI Agent）立规矩，防止同类设计再次出现。

## 一、问题的量化事实（重构前 vs 重构后）

| 指标 | 重构前 | 重构后 |
|---|---|---|
| 日常检查耗时 | doctor 15-25 分钟，一次交付最多跑 3 次，会话恢复再跑 1 次 | `check.sh` 全量 ~6s；`--quick` <1s |
| 检查代码规模 | doctor.py 22,320 行、1200+ 检查项；harness 脚本与自测 ~3.7 万行 | `scripts/checks/` 6 个文件约 1000 行 |
| 治理 vs 产品行数 | 治理 ~21.5 万 vs 产品 ~7 万（约 3:1） | 治理机制归零，历史产物只读归档 |
| 单个任务记录 | 200-320 行任务卡（60 项 forbiddenPaths、41 项 readAllowlist） | 无任务卡，`TODO.md` 一行一条 |

耗时根因：1200+ 项检查中约 80% 是"全量 git 历史重放"——对 1357 个提交逐个 `ls-tree`/`cat-file`/解析
YAML，反复验证本已不可变的过去。git 对象一旦提交即不可变；历史审计属于一次性动作，却被做成了日常守护。

## 二、病理特征（出现以下任一信号即已过度）

1. 日常检查超过 1 分钟，且没人说得清每项检查防的是什么。
2. 检查/治理代码行数接近或超过产品代码。
3. 同一套流程规则出现在 ≥2 个文件里互相引用（当时是 delivery-policy + ci-execution-policy + SKILL.md 三处复制）。
4. 存在自指规则："检查体系必须被执行""为检查体系改动走特殊审批"——机制在为自身续命。
5. "仅此一次"的特殊条款永久留在文档里（当时有 10 个）。
6. 每次会话开始、每次交付都要跑一遍全量审计。
7. 新增功能时，先想到的是"再加一层校验/流程"，而不是"现有测试是否已覆盖"。

## 三、硬规则

以下规则除非 Owner 书面批准，不得违反：

- **R1 耗时预算**：`scripts/check.sh` 全量 <60s、`--quick` <5s。新增检查前必须实测耗时，超预算者不得合入。
- **R2 只验证可变状态**：检查对象限于"当前工作树 + 本次 diff + 确定性生成物漂移"。禁止在日常检查中做
  全量 git 历史重放；历史审计如确需，一次性执行并记录结论，不进日常入口。
- **R3 唯一入口**：`bash scripts/check.sh` 是唯一日常检查入口。禁止建立 doctor/precheck/verify 之类的
  多级检查编排或第二套检查体系。
- **R4 规则单一出处**：开发流程与检查说明只维护在 `AGENTS.md` 与本文。禁止在其他文档复制流程规则。
- **R5 禁止自指**：不创建服务于检查体系自身的任务、检查项、不变量或审批流。检查脚本的缺陷按普通代码
  处理（修复 + 测试 + 提交）。
- **R6 一次性操作不进永久文档**：特殊恢复、迁移、数据修补的步骤写在 issue/会话里，完成后即弃。
- **R7 删除优先**：检查失效、被覆盖或长期无人能解释时，直接删除；不注释、不保留"以防万一"。
- **R8 加治理产物前自问**："它让哪条产品测试变绿？"答不出来就不加。

## 四、如何正确新增一个检查

1. 脚本放 `scripts/checks/`，要求：本地确定性执行、无网络、秒级；数据文件随脚本同目录。
2. 在 `scripts/check.sh` 增加一行 `run <名称> ...`。
3. 实测 `time bash scripts/check.sh`，确认仍在预算内（R1），并把耗时更新到下表。
4. 用一个故意的坏输入验证检查真的会失败（防"永远绿"的假检查）。
5. 在本文第五节表格补一行说明它防的是什么。

## 五、现行检查体系

| 命令 | 实测 | 覆盖 |
|---|---|---|
| `bash scripts/check.sh` | ~6s | 下述全部 |
| ├ catalog validate/drift | <1s | `specs/catalog` 契约（含 Go v1 API scope 对账 OpenAPI）与 `specs/generated` 漂移 |
| ├ openapi validate/drift | <1s | `specs/openapi` 合同与生成物漂移 |
| ├ paid-features | <1s | 依赖/配置中禁止付费运行时前提 |
| ├ licenses | <1s | Maven/前端直接依赖许可证清单核对 |
| ├ frontend-test | ~2s | vitest 全量 |
| └ frontend-type-check | ~2s | vue-tsc |
| `./mvnw --batch-mode --no-transfer-progress verify` | ~19s | 后端 14 模块编译 + 全部 JUnit（JDK 25） |
| `bash infra/db/run-rls-tests.sh` | Docker | 123 个 SQL/RLS/并发测试 |
| CI（5 个 job） | — | checks / backend / database / frontend / supply-chain |

生成物重生成：`python scripts/checks/catalog_tool.py generate`（catalog）、`scripts/dev/openapi_tool.py`（openapi）。

## 六、事件存档

- 设计与决策：`docs/superpowers/specs/2026-08-16-checks-simplification-design.md`
- 拆除提交：`b175e86`（净 -34,709 行）；测试根标志修复 `ecde04f`
- 旧体系历史产物（只读）：`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/`
