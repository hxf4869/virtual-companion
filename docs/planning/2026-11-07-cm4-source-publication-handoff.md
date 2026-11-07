# CM-4 → SX：逐事实来源发布迁移需求（基于 main 79b4d72c）

Owner 2026-11-07 转交 server-sx 实现后，V292及逐记录target修正已合入main `7bd10436`。本文保留以V290/V291为基线的来源约束与联合验收；新七参/三参入口现已可用，CM在chat-memory-cm接入。SX独占迁移与SQL/RLS，CM负责prepare、Go逐事实校验与调用参数，不自行新增迁移。

## 1. 问题与范围

当前发布把同一个 `p_refs` 写给提取批次中的每条事实。直接将上下文窗口加入 `p_refs` 会使独立事实 A、B 互相绑定来源，遗忘 B 时连带删除 A。需要分别保存每条事实真正依赖的来源；模型看过的上下文不能自动成为事实证据。

只增加现有发布/清理函数的重载，不加表，不改 source_ref、来源读取协议、generation、SQL 触发器或锁序。不要修改历史迁移或恢复 V149 的旧函数正文；从 SX 届时最大版本顺延一个迁移（当前最大 V291）。

## 2. 当前 main 的函数基线

发布函数以 `V290__stored_chat_sources.sql` 的定义为准：

```sql
vc.go_publish_memorycore(
  p_owner bigint, p_job bigint, p_token text, p_fence text,
  p_proposal jsonb, p_refs text[]
) RETURNS void
```

它依次保留 owner assertion / memory barrier、operation 锁与已发布幂等返回、scope revision、有效 claim/lease、auto-save、非空来源、`guard_st_evidence_write`、会话/来源 scope、target version，以及全批原子发布校验。

`guard_st_evidence_write` 不能退回旧的来源 guard：V290 在原来源检查之外增加 authority 的 `FOR SHARE` 锁、FROZEN 禁写、GO 权威下 raw chat 存在且未删除、`st_applied_revision = raw.revision` 的水位检查。evidence 插入触发器也必须继续走此写 guard。旧来源 guard 没有 user-only 限制，助手支持来源不需要扩大 SQL 权限。

画像函数以 `V291__stored_chat_audit_fixes.sql` 的九参定义为准：

```sql
vc.go_record_memorycore_profile(
  p_owner bigint, p_job bigint, p_token text, p_fence text,
  p_refs text[], p_persona text, p_scenes jsonb,
  p_record_ids text[], p_fingerprint text
) RETURNS bigint
```

**本需求不新增画像签名，也不要求替换该函数。** 保留 V291 对模型声明 refs 和完整 allowlist 剩余 refs 的全部写 guard、完整 record set / fingerprint 校验，并继续持久化 `full_refs` / `full_ids`，不能缩成模型引用的子集。

清理函数仍为 V149 的 `vc.go_memorycore_cleaned(bigint,bigint)`：将 REVOKED operation 改为 CLEANED 并清空 proposal。它无法完成“保留仍有效的兄弟事实”后的持续失效追踪，因此本次同时需要三参重载。

## 3. 新七参发布契约

```sql
vc.go_publish_memorycore(
  p_owner bigint, p_job bigint, p_token text, p_fence text,
  p_proposal jsonb, p_refs text[], p_record_refs jsonb
) RETURNS void
```

实现以 V290 六参函数为底稿，保留第 2 节全部守卫与校验，仅增加逐事实映射校验并改变 evidence 写入集合。

`p_record_refs` 是由 Go 根据真实核验结果生成的 JSON 对象，键为本次 record ID，值为该事实的稳定 source_ref 数组。下例仅表示形状，不是可执行来源：

```json
{
  "record-a": ["<A 的用户来源 source_ref>"],
  "record-b": ["<B 的用户来源 source_ref>", "<B 的助手支持 source_ref>"]
}
```

- 映射键严格等于 `p_proposal.records` 的唯一 ID 集合；每条记录对应非空、无重复的字符串数组，不接受缺键、多键或未核验来源。
- 有记录时，各数组的去重并集严格等于 `p_refs`；每个并集来源继续通过 V290 的写 guard 与 scope 校验。发布循环只将当前 record 对应数组写入 `memory_evidence`。
- 零记录沿用现有空提案路径：`p_record_refs = {}`，`p_refs` 仍包含已核验的当前用户锚点，保留非空来源及写 guard，不写事实 evidence。
- 每条事实至少有一个已核验用户主来源。Go 从真实 `source_message_ids` 逐条核对，不能用聚合 metadata 替代，也不接受浏览器或模型直接提供完整 source_ref。该用户来源必须实际被该事实引用，不强制所有事实都引用当前 operation 的锚点。
- 助手支持限同会话、提取窗口内、当前选中候选且符合隐私门禁；纯助手事实拒绝。窗口中的无关用户/助手消息只参与在途校验，不持久绑定到每条事实。
- prepare / proposal 保留逐记录实际 source keys 与 `conflictTargetIds`；真正引用的旧 target evidence 从 PG 核验并继承，不能为缩小数组而丢弃真实依赖。
- 同一 operation 的全部记录原子发布，保留重复调用的幂等返回；不能逐条拆 operation 绕过发布状态。沿用现有 EXECUTE 角色、SECURITY DEFINER 与固定 search_path，不开放直接写 evidence 权限。

## 4. 新三参清理完成契约

```sql
vc.go_memorycore_cleaned(
  p_owner bigint, p_job bigint, p_retained_record_ids text[]
) RETURNS void
```

来源 fence 会把受影响的已发布 operation 标为 REVOKED；它只继续追踪 NEW / PROPOSED / PUBLISHED。若保留了事实却仍调用两参全清入口，其 proposal 被清空，幸存事实以后再失效就失去跟踪。

新入口要求：

- 只处理 REVOKED；已完成的相同请求保持幂等。retained IDs 不重复，必须严格等于本 operation 中已发布到 PG、尚未删除/替换、具有完整 evidence 且全部来源仍有效的记录集合。集合由 PG 独立核对，不能相信调用方任意挑选的保留列表。
- 任一来源因编辑、删除、遗忘、no_memory、无痕或权利屏障永久失效，整条事实清理；未发布记录、缺 evidence 记录不得保留。原生来源清理仍须保留幸存事实实际依赖的来源。
- **FROZEN 或暂时水位未对齐不能直接等同于来源永久失效。** 恢复沿用持久来源有效性语义；无法确定时停止本次恢复并重试，不能仅因写 guard 暂时返回 false 就删除事实。
- 非空幸存集合：把原 proposal 收敛到这些 records、实际 `source_message_ids` / 来源键及 dependencies，移除失效正文、vectors、无关上下文和旧 targets；原子恢复 PUBLISHED，使既有 source fence 能继续追踪。空集合采用原 CLEANED 语义。
- Go 的有效性判断、原生清理、结果回读及完成调用在同一个持有 owner memory barrier 的事务中；PG 完成失败应回滚，原生重复清理必须幂等。不得把“移出 allowlist”当作物理清理完成，也不让 REVOKED 永久滞留来绕过缺口。

原锚点失效后的画像重建仍受现有合法锚点规则约束；本需求不扩展画像重建流程，不能把尚未重建报告为成功。

## 5. 锁序与旧调用过渡

- 新发布保留 V290 原顺序。Go 的逐来源核验/恢复先持有同一事务的 `memory_write_barrier`，再锁来源；保留 SX 写路径已有 `vc_user → export_pointer_barrier → memory_write_barrier` 前缀及后续 authority / scope / source 锁序。不得持有来源锁后再倒序申请前置 owner/raw-chat 写锁。
- 六参发布入口保留 V290 行为；两参清理入口保留旧全清行为。允许内部委托，但必须证明不带新逐事实 metadata 的旧 Go 调用及已落盘旧提案仍能恢复，不能强迫旧调用满足新字段要求，也不批量改写历史 evidence。
- SX 迁移先合 main，并返回实际版本、准确签名及验证结果；CM 同步后才启用七参发布、三参清理与提取窗口。新调用缺函数时明确失败，不回退六参丢弃逐事实语义。
- 迁移前可继续查询补全、检索计算复用及已授权的普通清理版本修正；它们不依赖新签名。CM 不自行合 main、不部署，Owner 转交本说明，CM 不直接向其他聊天派发。

## 6. 联合验收

在迁移后的同一稳定候选验证，失败与未覆盖均单列：

1. 同批独立事实 A/B：忘 B 后，A 的 PG evidence、native 记录、召回与真实出站保留，B 不再出站。
2. 一条事实确实依赖 A+B：任一来源失效即清理整条事实，不保留另一来源继续发布。
3. 助手逐事实支持：编辑、删除、切换候选使对应事实失效；no_memory、无痕、跨会话、窗口外来源和纯助手提案拒绝。原生 gate 过滤用户主来源时，不得只把助手上下文送模型。
4. 未发布 native 记录清理；部分恢复后幸存事实再次编辑/删除仍能撤回；重复发布/恢复幂等；并发遗忘与发布/恢复不使已忘内容重新出站。
5. 六参旧调用、旧持久提案恢复、七参新调用、两参全清和三参部分清理均覆盖；缺少新函数时明确失败。
6. FROZEN 禁止新 evidence / profile 写入且不误清有效历史事实；GO raw revision 不一致拒绝发布/画像；权威恢复且水位对齐后可按现有流程重试。
7. V291 画像 full_refs / full_ids 保持完整：模型只声明来源子集，未声明但属于 allowlist 的来源变化仍使画像失效；不回退旧画像实现。
8. 保持 `memorycore_proposal_lock_integration_test` 与相关 profile/source/cleanup 回归通过；运行 RLS、受影响 Go store 集成及 CM 真实 SQLite/出站用例。
9. 用 CM-3 同一数据集比较提取、候选、最终排序、实际注入、回答与 token；人工复核、费用未核价及未跑项如实保留，不用离线通过代替质量通过。

CM 内部的旧 L0 回退时间兼容不需要新 SQL 结构：标记仅由 Go 根据实际缺少时间戳设置，新回退时间确定性；只在同 ID/scope/正文且有可信回退证据时复用，真实时间冲突仍拒绝。该候选继续随窗口代码隔离，不改变本迁移的来源协议和锁序。

当前状态（Owner 2026-11-07更新）：V292及逐记录target修正已合入main `7bd10436`，CM以`40083513`同步。七参发布/三参清理可用，六参/两参保持旧行为；所有target须由至少一个record.conflictTargetIds声明，未声明整批拒绝。CM窗口与新入口正在chat-memory-cm接入，PG直接联验已覆盖独立/联合/二次撤回/并发/未发布邻居、暂不可用零native变更、native失败回滚及旧targets实际发布；ff6b0120的真实SQLite/Go/最终出站已完成独立A/B、忘B保A、幸存A二次编辑撤回、joint删除任一来源、助手edit/delete/swipe后撤回与重启不恢复（65次本机fixture/22次出站，0外部调用）；隐私/跨会话/窗口外/纯助手的真实出站组合未跑，直接Go/Node边界回归已覆盖。真实模型质量轮仍待执行，不能将迁移或联合验收通过视为整项质量完成。
