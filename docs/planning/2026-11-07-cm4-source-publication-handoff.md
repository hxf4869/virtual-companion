# CM-4 → SX：逐事实来源发布迁移需求

Owner 2026-11-07 已批准，由 Owner 转交 server-sx。迁移只由 SX 编写；CM 负责 prepare 补丁、Go 逐记录校验与调用参数。此文是待双方冻结的接口提案，不代表迁移已经存在。

## 问题与范围

现 `vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[])` 定义于 `V149__memorycore_production_projection.sql`，将同一 `p_refs` 写给每条记录。把提取窗口直接并入该列表后，遗忘独立事实 B 会抑制无关事实 A 的来源，并触发原生记录清理。必须把“模型看过的上下文”与“每条事实真正依赖的来源”分开。

只调整现有发布函数族，不新增表，不修改 source_ref 格式、来源读取协议、generation、屏障或既有权限边界。保留 `vc.memory_write_barrier` 先于来源行锁，以及 operation、scope、claim、来源和目标版本的现有校验顺序。不要改写 V149；迁移版本由 SX 从自己的最新版本顺延。

## 建议 SQL 契约

保留原六参数入口，新增同名七参数重载：

```sql
vc.go_publish_memorycore(
  p_owner bigint, p_job bigint, p_token text, p_fence text,
  p_proposal jsonb, p_refs text[], p_record_refs jsonb
) RETURNS void
```

`p_record_refs` 由 Go 从已核验来源生成，以本次 record ID 为键、稳定 source_ref 数组为值；不接受浏览器或模型直接提供的完整 source_ref。例如以下只是形状占位，不是可执行来源：

```json
{
  "record-a": ["<A 的已核验 source_ref>"],
  "record-b": ["<B 的已核验 source_ref>", "<B 的助手支持 source_ref>"]
}
```

- `p_refs` 是所有记录真实来源的去重并集，继续使用现有逐来源 guard 和 scope 校验。
- 新入口要求映射键与 `p_proposal.records` 的唯一 ID 集合严格相等；每个非空记录的来源数组非空、无重复且无额外来源；有记录时全部数组的并集与 `p_refs` 相等。空输出沿用既有空提案流程：映射为 `{}`，`p_refs` 仍含已核验的当前用户锚点（V149 明确拒绝空 `p_refs`）；无事实 evidence 写入，不为满足并集条件取消锚点 guard。
- 每条记录至少含已核验的用户主来源。Go 逐条核对真实 `source_message_ids`，不能以聚合 metadata 替代；助手支持限定为该用户锚点同会话、窗口内、当前候选且符合隐私门禁的来源。
- 发布循环只把该 record 对应的数组写入 `memory_evidence`。保持同一 operation 内全部记录原子发布，不能逐条拆 operation 或重复调用绕过 `PUBLISHED` 幂等返回。
- `p_proposal` 保存每条事实的实际 source keys 和逐条 conflict target 对应关系（候选字段 `conflictTargetIds`）；上下文窗口只参与在途核验，不自动成为每条事实的持久 evidence。实际引用的旧 target evidence 必须继承，不能为缩小来源而丢失。
- 保留既有 owner/role EXECUTE 授权及 SECURITY DEFINER/search_path 约束，不授予应用直接写 evidence 的权限。

## 过渡与合入顺序

1. SX 保留六参数旧入口的现有行为；可由旧入口构造“每条记录共用旧 p_refs”的映射后委托新实现。旧 Go 与已持久化旧提案仍可续跑，不给既有记录批量改写 evidence。
2. SX 先提交迁移与 SQL/RLS 回归，经其流程合入 main；交给 CM 实际迁移版本、函数契约及测试结果。
3. CM 同步该 main 后才启用七参数调用和提取窗口。新调用不回退六参数：新函数缺失时应明确失败，不能静默丢失逐事实语义。
4. 迁移落 main 前，CM 只交付查询补全和原生检索计算复用；依赖新入口的代码保留在隔离候选，不能作为可合 main 的完整 CM-4 提交。
5. 迁移与新调用均保留同一个 operation 的 claim/fence、事务和幂等语义；重复发布不重复插入事实或 evidence。旧入口移除不属于本任务。

## CM 配套与联合验收

CM 修改既有 prepare 补丁以保留每条新记录对应的 conflict targets，并调整 Node/Go：分别维护实际上下文核验集合、逐事实来源、真正继承的旧证据。Go 的 `memorycore_runtime.go` 改动范围将明确列在提交说明中，供 SX-7 合并。

必须在同一稳定候选上验证：

1. 相邻独立事实 A、B：遗忘 B 后，A 的 PG 来源、原生记录、召回与真实出站均保留；B 不再出站。
2. 一个事实确实联合依赖 A、B：任一来源被遗忘、删除或失效后，该事实均不再召回或出站，不能只留另一来源继续发布。
3. 助手支持按每条事实生效：支持句编辑、删除、切换候选使对应事实失效；no_memory、无痕、跨会话、窗口外助手不可成为支持来源；纯助手引用即使伪装聚合 metadata 也被 Go 拒绝。
4. 原生 gate 过滤用户主来源时，不得只把助手上下文交给模型产生事实。
5. 原 `memorycore_proposal_lock_integration_test` 继续通过；覆盖模型执行期间来源变化、并发遗忘与发布、旧六参数调用、旧提案恢复、新七参数调用及重复发布。
6. CM-3 同一数据集比较查询、提取、候选、最终排序、实际注入、回答和 token；失败与未覆盖项保留分母。迁移尚未完成前不声明上述联合验收通过。

## 恢复清理边界（Owner 已批准）

**[问]（2026-11-07）**：V149 的 `memorycore_source_fence` 会在来源失效时把关联的已发布 operation 标为 REVOKED；Go `memorycore_profile.go::RecoverEngineOperations` 随后收集该 operation 全部 record/source IDs 并清理。同一批次的事实有不同助手支持或不同旧 target 证据时，只修逐事实发布仍会误删有效的兄弟事实。

**答（Owner 2026-11-07）**：允许该 Go 函数的最小修正及直接回归。逐事实判断：任一来源因编辑、删除、遗忘、no_memory、无痕或权利屏障失效，该事实即清理；仅全部来源仍有效且已有 PG 发布投影的事实保留，宁可多删、不可漏删。来源清理也须保留有效事实仍依赖的来源。

来源有效判断与清理在同一事务内完成，保持 `memory_write_barrier` 先于来源行锁。直接回归必须覆盖同批独立 A/B 忘 B 后恢复 A 留/B 清、联合依赖 A+B 忘任一清除、未发布记录清理、重复恢复幂等，以及恢复中并发遗忘不得使已忘内容重新出现在出站召回。不改 SQL 触发器、来源协议或锁序；依赖新签名部分仍等迁移合 main 后再合入。查询补全与检索计算复用不依赖该修正。

### 部分清理完成的函数提案（须 SX 一并冻结）

现 `vc.go_memorycore_cleaned(bigint,bigint)` 将 operation 标为 CLEANED 并清空 proposal。若恢复时保留了有效事实，仍调用它会失去这些事实后续编辑/删除时的失效追踪：既有 source fence 只处理 NEW/PROPOSED/PUBLISHED。因此只修改 Go 筛选仍不完整。

建议在同次函数迁移中增加 `vc.go_memorycore_cleaned(p_owner bigint,p_job bigint,p_retained_record_ids text[]) RETURNS void` 重载；保留现两参数入口供无幸存记录的旧清理调用。新入口沿用 owner/EXECUTE/SECURITY DEFINER 约束，在同一事务中先 owner barrier 再锁 operation 与来源：

- 仅处理 REVOKED；已经 PUBLISHED/CLEANED 的重复完成调用沿用幂等语义。非空 retained IDs 去重，必须严格等于该 operation 中已经发布且全部 evidence 仍有效的 PG 事实集合；不可保留未发布、已删、已替换、来源失效或缺少 evidence 的记录。Go 不提交重新编造的正文或 source refs。
- 从已核验 PG evidence 得出幸存来源键并集，将原 proposal 收敛到幸存 record 与其实际 `source_message_ids`、`dependencies`，移除已清理正文、vectors、上下文和旧 targets。原子恢复 PUBLISHED，使未来任一幸存来源失效仍可被既有 source fence 发现；没有幸存则走既有 CLEANED 语义。
- Go 的有效性判断、原生清理和完成调用都在同一个持有 owner barrier 的事务里；调用失败回滚 PG 状态，重复清理必须幂等。保留原生结果回读校验，不将“离开 allowlist”当成物理清理完成。

这仍是待 SX 冻结的函数提案，CM 不编写迁移、不用应用角色直接改 operation、不改变 trigger，也不把 REVOKED 永久滞留以绕过状态缺口。原画像重建仍依赖既有合法锚点；当只剩其他来源支持的事实而原锚点失效时，不能把画像未重建报告为成功，本项不扩展画像重建流程。
