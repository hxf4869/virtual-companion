# CM-11：以单一真源收编 MemoryCore 存储与检索

**建议将 Go + PostgreSQL 唯一持久真源作为收编目标，先证明精确检索与现有行为等价，再决定是否实施。** 最小完整范围包含 L0/L1、向量/全文索引、操作恢复和 L2/L3 产物；只换向量索引仍留下双状态，不算完成。提取、冲突、摘要、生成语义与模型配置保持比较基准；可评估暂留无持久状态的 Node 算法执行器。收益是减少跨库发布、版本追平、清理和备份协调，现有证据不能证明回答质量、延迟或成本改善。当前真实评测不完整且评审未校准，不能据此调低检索阈值。本文只供 Owner 决策，**没有实施 schema/API/代码、迁移或新增评测调用**。

## 当前 Go 业务真源仍依赖 SQLite 检索与文件恢复

证据固定于 `b1e34aef`（2026-11-07）；仓库链接以本文正式交付位置 `docs/planning/` 为基准。V287–V291 已提供 Go 聊天 authority、来源联动与画像写入栅栏，schema 安装不会自动切换实例 authority；聊天迁 Go 也不表示向量迁入 PG。早期计划“原聊天仍由 ST 持有”需按 ST/GO/FROZEN 路径理解，本次未读运行实例。（[聊天 authority](../../backend/internal/migrate/sql/V287__stored_chats.sql#L1)、[当前召回调用](../../backend/internal/store/postgres/memorycore_recall.go#L150)）

| 当前状态与消费者 | 最小目标职责 |
| --- | --- |
| PG `memory_item/evidence`、来源、scope、operation、claim/工作队列决定合法性；Go 将候选交引擎，命中后回映可信 PG summary | 复用这些模型与现有召回/管理接口；同一最终事务发布业务状态与检索状态 |
| 每账号 SQLite 保存 L0/L1、向量、FTS、native scope/receipt | Go 承接记录、索引、空间状态与幂等提交，消去第二套持久 revision/receipt |
| Node `operations/*.json`、JSONL 保存提案、调用 journal、阶段恢复 | 依照真实消费者映射到现有 operation/调用账本；必要缺项再论证，不另建通用框架 |
| Node staging/profiles 与退休文件参与 L2/L3 生成、清理、恢复、导出；PG `memory_profile` 已是生产读取投影 | 保留画像/场景及完整来源集合；PG 承接持久产物与发布状态，临时产物有界清除 |
| embedding 配置在 PG，native 另持空间配置与重建状态 | 保留 spaceId、artifact、维度、query/document 预处理、normalization、revision 与失败不 ready 语义 |
| 纠正、遗忘、账号删除、备份/恢复与导出跨 PG、SQLite、文件 | 保留版本、替代链、tombstone/suppression、当前权利门禁，覆盖全部在线副本 |

上述边界来自 [PG 投影/operation](../../backend/internal/migrate/sql/V149__memorycore_production_projection.sql#L3)、[native 提交与产物](../../integrations/sillytavern/memorycore-service/business.mjs#L395)、[画像生成](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L509) 和 [现有权利契约](../../specs/contracts/memory-recall-contract.yaml#L79)。历史 `memory_embedding` 是 `vector(64)`，V149 已清空撤权；不能无改动承接当前受管评测 **1024 维**空间。生产全部空间、规模与过滤选择性未盘点。（[旧表](../../backend/internal/migrate/sql/V62__embedding_recall_degraded.sql#L25)、[退役](../../backend/internal/migrate/sql/V149__memorycore_production_projection.sql#L116)、[当前常量](../../backend/internal/memoryengine/client.go#L56)）

## 工程代价主要在行为适配，不能用连接串替换估算

仅搬向量/FTS 可作验证切片，但不能作为最终方案；同时把算法重写为 Go 会混入更大语义变化。**推荐最小完整候选是 PG 承接全部持久状态与检索，暂留经实际适配的 Node 内容算法。** 当前 factory 直接构造 VectorStore，部分 store 调用同步，搜索/去重还消费完整对象；L2/L3 直接使用文件 backend。因此须按真实调用改成可信来源、合法旧记录/检索结果输入与结构化 proposal/画像输出，或对实际异步消费者作有界适配。不能假定改成 HTTP 或换连接串即兼容；不开放泛 SQL、任意文件读写，不新增平行记忆 API。（[同步与对象耦合](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L315)、[文件耦合](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L509)）

模型调用继续经现有 Go 能力、用量与预算入口，置于提交事务之外；回写仍核验 live claim、来源、scope 和 target version。现有“MemoryCore 为唯一提取 authority”条款须随未来实施候选同步核对。（[调用入口](../../backend/internal/store/postgres/memorycore_call.go#L22)、[当前契约](../../specs/contracts/memory-recall-contract.yaml#L8)）

主要工作是 store/产物适配、索引与词法等价、事务发布/恢复、权利与备份迁移四块。当前实际为 **12 项 patch**，不是旧计划的 10 项；只有相关消费者被替换后，才能删除相应补丁与 runtime 锁。双 revision 漂移和画像失败恢复已有记录，单库能收敛这些协调面，但不会自动修好提取、指代、事实来源、画像模型失败或不稳定评审。没有生产盘点与候选实测，不能给人日、停机时长、人民币报价或提速比例。（[patch 清单](../../integrations/sillytavern/patches/memorycore/index.json#L4)、[已知恢复缺口](2026-10-31-handoff-backlog.md#cm-5-已知缺口历史-native-scope-版本领先-pg)）

pgvector 0.8.5 默认 exact，`<=>` 为 cosine distance。先在相同 owner/scope、合法 allowlist、日期和空间集合内精确排序取 Top-K，空 allowlist 仍为空。ANN 在扫描后过滤，可能缺额或遗漏近邻；iterative scan 有扫描上限，`strict_order` 只保证返回项排序，不保证完整召回。`vector` ANN 索引上限 2000 维，不代表全部受支持空间都能直接建此索引。RLS 不能替代业务来源/allowlist 校验；表所有者通常绕过 RLS，但可用 FORCE ROW LEVEL SECURITY 约束，超级用户与 BYPASSRLS 角色仍绕过。（[pgvector 0.8.5](https://github.com/pgvector/pgvector/blob/v0.8.5/README.md)、[PG18 RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)）

中文全文是实质未决项：现有写入先调用 `tokenizeForFts`，查询用 FTS5 BM25 再转换分数；模块定位为 `core/store/tokenize`，**实际算法源码与评分公式未核验**。PG 默认 parser、simple dictionary、`ts_rank` 不等于当前预分词/BM25；同为 0–1 分数也不等价。须比中文及中英混合的词元、候选、顺序、原始分数与 gate 决定，不直接复制 `ftsFloor`，也不预设安装中文扩展。（[受管导出定位](../../integrations/sillytavern/scripts/lib/memorycore-managed.mjs#L82)、[现有查询](../../integrations/sillytavern/patches/memorycore/09-prefilter.json#L44)、[SQLite FTS5](https://www.sqlite.org/fts5.html)、[PG18 parser](https://www.postgresql.org/docs/18/textsearch-parsers.html)、[PG18 排名/查询](https://www.postgresql.org/docs/18/textsearch-controls.html)）

## 现有基线说明质量缺口，尚不能证明迁库收益

下表摘录本次交接已核验的本地 `summary.json` 数值，非本文新增实测；原产物处于忽略目录，不作为远端可用文档链接。统计口径与保留规则见 [质量计划 §2–3](2026-11-06-chat-memory-quality-plan.md#3-记忆评测真实模型合成长对话分层归因)，来源及版本限制同时记入本地 CM-11 NOTES。

| 冻结版本 | 真实结果与适用限制 |
| --- | --- |
| CM3 `07ecf9bf`；seed `20261106`；800 消息/300 合格用户来源/core140 | 正确 **48/140**，执行132/140；Go 272 DONE/28 DEAD；145来源发布含28死信来源；profilesReady=0。final recall@5=69.2%；全部证据出站41/86=47.7%；遗忘14 PARTIAL/6 target missing。二审21/22=95.5%，人工 NOT_RUN。pipeline首字p50/p95=6.849/13.829s、末字7.164/13.988s，非浏览器可见绘制 |
| CM3 诊断修复 `17307f05` | 原诊断曾将空换行误判；仅补跑29调用，memory-off 2/7、gold-evidence 6/7，14/14执行；原core未改 |
| CM4 旧候选 `f25a577f`，仅 query/cache，未含新 main/当前修复 | 正确 **43/140**，执行133/140；七类各20题，正确数8/5/2/10/0/5/13；261 DONE/39 DEAD；148发布含39死信；profilesReady=0。final recall@5=66.3%；全部证据出站31/86=36.0%；15 PARTIAL/5 missing；二审18/22=81.8%＜90%，人工 NOT_RUN。0 observed leaks覆盖不足；性能采集与合并验证重叠，不能用于 nonregression |
| 后续修复与待办 | 旧候选198观测回答：343 HTTP/323实际检索/0复用/20未知。Go map ID顺序进入cache key；`bd079e15`只排序key副本，19相关/桌面203 PASS，修后真实命中率 NOT_RUN。`cd6da2b6`补Node失败画像journal revision，业务43/43与桌面203 PASS；Go自动重建至DONE联合验证 NOT_RUN |
| 累计计量，非单轮成本 | 两轮含历次尝试6933调用：6657 SETTLED/275 UNKNOWN/1 NOT_SENT；已知输入20,671,711/输出6,955,702 tokens。Owner授权token模式，费用未核价，不能当单轮正常成本或迁库报价；本CM11无新增被测模型调用/评测费用 |

V290/V291 后逐事实七参发布、三参清理仍待 SX，当前为六参/两参，不能当已解决的来源行为进入比较。画像九参沿用 V291 完整来源/记录集；窗口变更与迁库应分开形成候选。（[CM4 迁移交接](2026-11-07-cm4-source-publication-handoff.md#2-当前-main-的函数基线)）

## 一次性切换必须同时解决写后回滚与删除承诺

未来若获实施授权，可复用现有离线锁与备份入口：旧路径保持唯一 writer；受控停写、排空或围住在途任务后，协调 PG 与 SQLite/文件的同一截点，再一次性导入隔离 PG 候选。SQLite backup API 只保证 SQLite 自身一致，不能自动形成跨库一致点。核对稳定记录ID、版本/替代链、scope、完整 evidence/dependency、空间/向量、operation及清理意图、画像产物；字段与关系差分不能只看计数。通过恢复与检索检查后切唯一 writer，不做永久双写。（[当前备份/恢复门](../../integrations/sillytavern/scripts/lib/memorycore-backup.py#L77)、[SQLite Backup API](https://www.sqlite.org/backup.html)）

**新路径接受写入前可撤回，接受写入后不能只切旧镜像。** 旧 SQLite 已落后，必须先停写，证明新增提交、纠正、删除意图可导回/回放且不复活，或由 Owner 明确接受已知损失范围；没有此方案就不承诺无损回滚。隔离恢复须验证 schema/扩展/权限与 RLS，并以当前删除与来源权利重新设门后才允许读取，不能信任旧快照中的旧 rights；按现有保留规则处理旧副本，不另建备份系统。（[权利契约](../../specs/contracts/memory-recall-contract.yaml#L79)、[现行 PG 备份](../../infra/db/backup/README.md#L3)）

SQLite 当前测试检查 forget 后 marker 不在指定 db/WAL、clear-owner 后 db/wal/shm 消失；这是源码证据，本次未跑，且不证明全部介质/备份不可恢复。PG DELETE 留旧版本，普通 VACUUM 回收空间，VACUUM FULL 重写也不是官方安全覆零承诺；RLS 不负责擦除，WAL/历史备份另有恢复范围。**PG 等价 physicalErasure 尚无实现证据**，不能用 DELETE+VACUUM 宣称通过。保留已定普通遗忘边界：长期记忆、派生画像、记忆槽清理；原聊天与离线备份不属一次遗忘，近期原文仍在上下文时如实说明。（[现有测试](../../integrations/sillytavern/tests/memorycore-secure-delete.test.mjs#L98)、[SQLite secure_delete](https://www.sqlite.org/pragma.html#pragma_secure_delete)、[PG18 VACUUM](https://www.postgresql.org/docs/18/routine-vacuuming.html#VACUUM-FOR-SPACE-RECOVERY)、[PG18 WAL/PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)、[现有遗忘语义](../../backend/internal/migrate/sql/V157__memorycore_revision_rebind.sql#L129)）

## 同评测先隔离存储差异，Owner 再决定实施条件

未来验收先校准 judge/rubric 与人工盲评一致率至≥90%；当前二审不稳定、人工未跑，不能拿分数调阈值。冻结同 seed/core140、事件顺序/时钟、来源与记录快照、embedding向量和完整空间身份、模型用途/参数、提取/冲突/摘要语义、rerank及注入预算；先复用可兼容的保存输出做存储差分，再单独做真实端到端。只标记 `engineStore` 变化，不把模型、窗口、新来源迁移混入归因。（[固定评测与评审规则](2026-11-06-chat-memory-quality-plan.md#33-指标规则与-llm-评审)）

分层顺序为数据/恢复完整性→相同合法集合的exact距离、Top-K与临界gate→词法/融合→rerank、实际注入和回答。区分浮点微差、候选遗漏、提取失败、未发布与未注入，保留允许空结果、日期、完整scope、来源/target/claim最终复核。覆盖迟到结果/重启重放、纠正、暖缓存遗忘、画像失败后到DONE、部分空间重建及导出/恢复几个真实切点。exact通过且确有性能需要后才单独评ANN，对exact报告recall@K、缺额与最终注入差分；核实查询计划，单独运行冷热/规模/并发一致的性能采样，不相加重叠阶段。（[pgvector exact 对照](https://github.com/pgvector/pgvector/blob/v0.8.5/README.md#monitoring)）

原门槛不放宽：recall@5≥90%、@20≥95%、全部证据出站≥90%、可回答总体≥85%/每类≥75%、纠正当前值≥95%、零越界/遗忘复活；覆盖100%，分类和区间同报。相对等价与绝对达标分别判断，迁库等价不代表产品质量合格；预算仍按届时授权模式，缺价不宣称人民币硬上限通过。（[原质量门槛](2026-11-06-chat-memory-quality-plan.md#33-指标规则与-llm-评审)）

Owner 需决定是否进入实施、是否接受暂留无状态Node、在线字节清除/physicalErasure契约、维护窗口与写后回滚处理，并与SX确认来源函数基线。未来涉及SQL迁移仍交SX，CM提供契约/消费者；本报告不授权实施。运行版本、全量空间/规模、tokenizer真实算法、PG词法/排名等价、恢复/删除保证与性能收益均未验证。本次文档完成后停止；这些决定不因报告交付自动立项或启动任何迁移。
