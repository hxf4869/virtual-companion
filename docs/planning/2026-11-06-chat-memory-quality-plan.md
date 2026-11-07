# 聊天 + 记忆质量计划（2026-11-06）

本计划把“聊得顺、记得准、改得掉、忘得掉”作为核心交付，用同一批可复现数据比较每次改动。Owner 已决定优先做好聊天与记忆，记忆效果评测使用真实模型。**2026-11-07 最新决定：不设评测费用上限，取代每轮 ¥100；保留计量与正常完整轮两倍 token 异常停止，完整 core140 逐轮迭代。** 当前执行规则见 Backlog N 节及本文 §6 最新答复；下文旧金额估算和 CNY 上限设计保留为历史背景，不作为本次运行限额。

本文是方案，不是实施完成报告。代码证据固定于工作树 `/workspace/next-mem` 的 `ecac91ad`（detached）；初始工作树干净。本轮只新增本文，未修改代码、specs、TODO 或 Backlog，未提交或推送，未启动 Docker、模型或数据库，未读取 `config.txt`、私有配置或凭据。下面的数值均明确区分历史记录、建议目标与费用估算。

## 0. 范围与约束

- 遵循 [拟人化设计 §0](2026-10-30-companion-humanlike-design.md#0-原则)：格式与频率由代码保证；允许有依据的沉默；状态持久化、幂等；从简，第一轮质量改进不新增 planner 调用。
- 桌面以 [UX-23 §0](2026-11-02-ux23-chat-redesign.md#0-决定) 的“状态真实、不加拟人延迟、不伪造已读”为准。其旧宿主 DOM 实施细节不能直接当作当前 React 实现。当前桌面目录实际为 `integrations/sillytavern/desktop-ui`。
- 微信 / Telegram 是交互手感的参照：点击有反馈、历史可快速读、发送状态可信、滚动位置稳定。本文没有对这两个产品做实测，也不推断其内部存储实现。
- 不新增常驻服务，不用新增受管场景数量衡量完成度。复用现有脚本、observability、model-usage 和隔离栈；新增内容限于后续获准实施的测量参数、数据集、指标采集与必要回归。
- CM 编号仅为本文的候选工作包，不自动成为 Backlog/TODO 条目或实施授权；本轮不回填这些文件。

为使表格可读，下文代码定位使用以下**仓库相对路径前缀**；冒号后的数字均为 `ecac91ad` 的行号：

| 前缀 | 完整目录 |
| --- | --- |
| `B/` | `backend/internal/` |
| `D/` | `integrations/sillytavern/desktop-ui/src/` |
| `X/` | `integrations/sillytavern/extension/vc-model-settings/` |
| `N/` | `integrations/sillytavern/server-plugin/virtual-companion/` |
| `M/` | `integrations/sillytavern/memorycore-service/` |
| `S/` | `integrations/sillytavern/scripts/` |
| `T/` | `integrations/sillytavern/tests/` |

## 1. 现状：从聊天来源到最终回复

### 1.1 真实执行路径与存储边界

```text
React Composer → session-bridge → desktop/standalone/session
  → ST JSONL + F2/CAS 保存 → Go 来源核对 / 提取任务
  → MemoryCore propose → Go Broker 调真实模型（L1、冲突、L2、L3）
  → 引擎 commit + Go 发布投影 / 来源 / 生命周期

下一轮发送 → 浏览器记忆拦截器 → Go 召回
  → SQL 合法候选 / 日期 / 实例 → MemoryCore 向量 + FTS + rerank
  → Go 验证来源并按 token 预算组块 → 浏览器 depth 1 注入
  → Node 出站再次召回 / 替换槽 → 前台模型 → 流式显示 → CAS 保存

纠正 / 遗忘 → Go 版本与生命周期门禁 → 引擎替换 / 清理
  → 画像失效及重建 → 后续召回与最终出站重新核对
```

聊天原始消息仍由 ST JSONL 持有，整份读取、整份 CAS 保存（[X/desktop/standalone/client.js:38](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/client.js#L38)、[X/desktop/standalone/session.js:88](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L88)）。记忆业务状态、来源、任务、投影与用量在 Go+PG；MemoryCore 自有 SQLite/FTS/向量库及操作、记录、画像文件（[M/native-engine.mjs:343](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L343)、[M/business.mjs:38](../../integrations/sillytavern/memorycore-service/business.mjs#L38)、[M/storage.mjs:18](../../integrations/sillytavern/memorycore-service/storage.mjs#L18)）。**不能把当前记忆向量查询描述为 PG/pgvector 查询，也不能把聊天存储迁往 Go+PG 等同于记忆引擎迁库。**

[B/companion/engine.go:47](../../backend/internal/companion/engine.go#L47) 提供 Go 的流式执行、输出检查和预算边界，[B/turn/builder.go:21](../../backend/internal/turn/builder.go#L21) 提供纯函数提示组装、记忆筛选与裁剪；它们不是当前桌面前台生成入口。当前前台由 [X/desktop/standalone/session.js:280](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L280) 的 engine.prepare/client.generate/readResponse 执行；[B/httpapi/generation.go:23](../../backend/internal/httpapi/generation.go#L23) 这里只注册反馈。不能仅给 Go `StreamAttempt` 打点，就声称已经测到桌面 TTFT。

### 1.2 管线逐步审计

| 步骤 | 当前实现及位置 | 模型用途 | 缺口与质量风险 |
| --- | --- | --- | --- |
| 来源与入队前提 | [X/desktop/standalone/session.js:254](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L254) 保存用户消息，再准备生成；`:339` 保存最终回复。[B/store/postgres/st_sources.go:122](../../backend/internal/store/postgres/st_sources.go#L122) 应用已核对来源快照；[B/store/postgres/st_memory_extract.go:13](../../backend/internal/store/postgres/st_memory_extract.go#L13) 读取任务绑定的不可变来源并再次核对 | 无 | 已有来源/revision/settled 边界；需要测“保存→L1 可召回→画像可用”的耗时和失败率，不能用固定 sleep 当提取完成 |
| L1 提取、去重与改口 | [B/jobs/memorycore_extract.go:28](../../backend/internal/jobs/memorycore_extract.go#L28) 编排 operation-status/propose/validate/commit/publish；`:84` 传给提取器的是**一条用户来源消息**。[M/native-engine.mjs:365](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L365) 调 extractL1Memories；[M/memory-policy.mjs:1](../../integrations/sillytavern/memorycore-service/memory-policy.mjs#L1) 过滤纯短暂状态并补来源时间规则 | `MEMORY_EXTRACTION_DEDUP_SUMMARY`；阶段 `l1-extraction`、`l1-conflict-detection`，不是前台聊天用途 | 依赖模型产出，规则仅覆盖有限“累/困/饿”。“对，就是那个”等单句丢失上下文的风险要单测质量；不能把助手自述或主动消息当用户事实。改口指令存在不代表新旧事实判定全部正确 |
| 时间规范化 | [B/memorytime/normalize.go:47](../../backend/internal/memorytime/normalize.go#L47) 接收来源时间、IANA 时区；支持具体日期、下周几、今天/明天/后天、明确 HH:mm；`:62` 不明确时 needs_clarification。[M/memory-policy.mjs:6](../../integrations/sillytavern/memorycore-service/memory-policy.mjs#L6) 替换可验证相对日期 | 规范化为代码；提取模型消费该结果 | 不覆盖一般时间推理、复杂多事件、所有相对表达。日期解析通过不等于模型会判断先后、间隔或区分计划/已完成。重试/跨日不得用运行时钟重释来源 |
| 持久化、发布 | [M/business.mjs:38](../../integrations/sillytavern/memorycore-service/business.mjs#L38) 按 owner 开目录/队列；[M/native-engine.mjs:343](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L343) SQLite 与 secure_delete。[B/jobs/memorycore_extract.go:141](../../backend/internal/jobs/memorycore_extract.go#L141) 先验证再 commit/publish；[B/store/postgres/memorycore_runtime.go:334](../../backend/internal/store/postgres/memorycore_runtime.go#L334) 检查模型依赖，`:422` 发布业务投影 | 向量由真实本地 embedding 生成；发布本身不调用聊天模型 | 两侧状态需要恢复和 fence，已有相应机制。必须单列提取成功但未发布、发布但画像失效、来源失效；“数据库里有一行”不等于可注入 |
| L2 场景、L3 画像 | [B/jobs/memorycore_extract.go:167](../../backend/internal/jobs/memorycore_extract.go#L167)、[B/store/postgres/memorycore_profile.go:32](../../backend/internal/store/postgres/memorycore_profile.go#L32)；[M/native-engine.mjs:470](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L470) SceneExtractor/PersonaGenerator；[M/llm-runner.mjs:135](../../integrations/sillytavern/memorycore-service/llm-runner.mjs#L135) 有限文件工具循环，默认 maxSteps=12 | 同一记忆用途，`l2-scene`、`l3-persona`；每个工具续步也是真实调用 | 多次调用与累计画像带来成本/延迟放大；失败后画像不可用不能记成成功。[M/business.mjs:437](../../integrations/sillytavern/memorycore-service/business.mjs#L437) 只读当前 revision 且依赖完整的画像；长历史压缩丢事实需要独立测量 |
| 召回前置门控 | [B/store/postgres/st_memory.go:115](../../backend/internal/store/postgres/st_memory.go#L115) 加载当前问题与画像，`:137` 寒暄门控，`:159` 日期规范化，`:160` topK=20；`:381` 是有限寒暄规则。[B/store/postgres/memorycore_runtime.go:33](../../backend/internal/store/postgres/memorycore_runtime.go#L33) scope 绑定 owner/relationship/mode/domain | 无新增 LLM；查询向量使用 embedding | 只用当前问题文本；缺少主题词的指代问句缺少补全。应同时测“不该召回时保持空”和“短但有意义的问题不被误挡” |
| 合法候选、检索 | [B/store/postgres/memorycore_recall.go:150](../../backend/internal/store/postgres/memorycore_recall.go#L150) 并行读合法候选/embedding/rerank 设置；`:177` 发送 allowlist。[M/business.mjs:448](../../integrations/sillytavern/memorycore-service/business.mjs#L448) 再限定已发布记录/当前 revision；[M/native-engine.mjs:243](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L243) 原 cosine/FTS 门槛与关键词补召回；`:216` 宽候选 | `EMBEDDING` 独立配置：qwen3-embedding:0.6b、1024 维，artifact/space/preprocessing 固定（[B/memoryengine/client.go:56](../../backend/internal/memoryengine/client.go#L56)、[M/embedding.mjs:70](../../integrations/sillytavern/memorycore-service/embedding.mjs#L70)） | 向量空间重建时退到词法路径；必须分层报告。候选被 SQL 门禁挡掉、没检出、检出但没注入不能混为一个 miss。置顶会影响最终顺序（[B/store/postgres/memorycore_recall.go:210](../../backend/internal/store/postgres/memorycore_recall.go#L210)），需同时报置顶前后 |
| rerank 与摘要门控 | [M/rerank.mjs:8](../../integrations/sillytavern/memorycore-service/rerank.mjs#L8) 本地 bge-reranker-v2-m3 配置，候选20、超时2秒、行级摘要；[M/native-engine.mjs:420](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L420) 并行检索，`:446` 合并原门控与 rerank；失败退回原门控。`:110` 处理摘要/画像相关性 | 本地 cross-encoder，无远程聊天用途；部署开关和 owner 开关共同作用 | 当前是**原门控与 rerank 的并集**，不是纯 rerank top-k。阈值校准来自25条记忆/100问，78个正例、22个负例（[M/rerank.mjs:1](../../integrations/sillytavern/memorycore-service/rerank.mjs#L1)），属于校准集结果，不能当独立泛化成绩；可能受候选截断/长摘要分行影响 |
| 注入与最终出站 | [B/store/postgres/st_memory.go:224](../../backend/internal/store/postgres/st_memory.go#L224) 最后检查纠正/删除竞态，`:263` 历史资料包装与预算，`:296` 画像/场景门控。[X/memory-injection-logic.js:55](../../integrations/sillytavern/extension/vc-model-settings/memory-injection-logic.js#L55) 默认1024、范围128–2048 tokens；`:146` 浏览器召回，`:162` topic/core **都在 depth 1**；[N/lib/memory-guard.js:135](../../integrations/sillytavern/server-plugin/virtual-companion/lib/memory-guard.js#L135) 出站再次召回，`:172` 仅替换已有槽 | 最终回答使用 `FOREGROUND_CHAT`；记忆块是数据，不是另一次 planner | API recall 返回 block 不保证最终 prompt 有同样内容：来源竞态、槽缺失、预算/后续上下文裁剪均可能丢失。“本次想起”UI不能替代实际出站观测；必须检测最终请求中的事实覆盖 |
| 手动纠正 | [D/features/memory/CorrectMemory.tsx:16](../../integrations/sillytavern/desktop-ui/src/features/memory/CorrectMemory.tsx#L16)、`useMemoryState.ts:440`；[D/data/queries/memory.ts:310](../../integrations/sillytavern/desktop-ui/src/data/queries/memory.ts#L310) 带 expectedVersion。[B/store/postgres/memory_management.go:128](../../backend/internal/store/postgres/memory_management.go#L128) reserve/version/来源验证，`:278` commit，`:308` 发布替代；[M/business.mjs:258](../../integrations/sillytavern/memorycore-service/business.mjs#L258) correct-propose | 纠正文本不必再让聊天模型改写；重新 embedding，后续画像重建可能花费 | UI 已有冲突与重新认证处理。需测新事实生效时延、旧事实残留、修订可解释性、重启/并发不复活；自然语言改口与手动纠正分别计分 |
| 遗忘 | [D/data/queries/memory.ts:330](../../integrations/sillytavern/desktop-ui/src/data/queries/memory.ts#L330) 调遗忘并失效缓存。[B/store/postgres/memory_management.go:321](../../backend/internal/store/postgres/memory_management.go#L321) begin；`:366` 异步清理，`:406` 等待画像 gate，DONE/PARTIAL 有区别。[M/business.mjs:558](../../integrations/sillytavern/memorycore-service/business.mjs#L558) 清记录/来源/派生文件；[M/native-engine.mjs:348](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L348) secure_delete、`:358` WAL checkpoint | 删除门禁无需 LLM；剩余画像重建使用记忆用途并计费 | 请求成功不是物理清理完成。必须测已忘事实不出现在 L1/L2/L3、两次召回和真实出站，也测在途提取/重启后复活；原聊天历史仍包含该事实时的产品语义见 §6 |

模型执行与账本的共同边界：[B/memorycore/callback.go:76](../../backend/internal/memorycore/callback.go#L76) 冻结用途快照，`:109` 仅放行四类阶段，`:128` 限 callSequence，`:131` 输出上限 min(4096, profile 上限)，`:153` 输入估算上限32768，`:183` 调前准备与预算，`:234` 记录结果。[B/memorycore/budget.go:9](../../backend/internal/memorycore/budget.go#L9) 是**超时预算**（单调用最长5分30秒等），不是 ¥100 费用上限；[B/memoryengine/client.go:91](../../backend/internal/memoryengine/client.go#L91) 是本机受限传输，也不是费用控制器。

### 1.3 已有测试究竟证明什么

| 证据 | 已覆盖 | 不能据此宣称 |
| --- | --- | --- |
| `B/memorycore/callback_test.go`、`B/memorytime/normalize_test.go`、[B/companion/engine_test.go:57](../../backend/internal/companion/engine_test.go#L57)、`B/turn/builder_test.go` | 能力/replay/预算边界，日期规则，流式状态/取消，确定性提示裁剪与同意门禁 | 真实模型事实提取、理解日期、回答准确率或桌面速度 |
| [T/memorycore-business.test.mjs:89](../../integrations/sillytavern/tests/memorycore-business.test.mjs#L89)、`:447`、`:719`；[T/memorycore-secure-delete.test.mjs:98](../../integrations/sillytavern/tests/memorycore-secure-delete.test.mjs#L98)；`B/store/postgres/memorycore_*integration_test.go`、`memory_management_integration_test.go` | 提案/commit/恢复、纠正、隔离、依赖与清理；部分测试检查 SQLite/WAL 字节清除 | 所有措辞、长历史、所有并发组合的语义正确性 |
| `scripts/eval-memory.mjs:30`、`:53`、`:76`；`scripts/fixtures/memory-eval-baseline.json`；[T/memory-eval.test.mjs:6](../../integrations/sillytavern/tests/memory-eval.test.mjs#L6) | 11个固定例、5类，真实 SQLite/FTS；**合成 LLM 输出 + 固定16维向量 + rerank关闭**；逐例与逐类不退步 | 22/22断言不是22道真实模型题，也不是独立真实向量质量分数 |
| [T/memorycore-recall-quality.test.mjs:9](../../integrations/sillytavern/tests/memorycore-recall-quality.test.mjs#L9)；[T/memorycore-rerank.test.mjs:28](../../integrations/sillytavern/tests/memorycore-rerank.test.mjs#L28)；[T/memorycore-perf.test.mjs:249](../../integrations/sillytavern/tests/memorycore-perf.test.mjs#L249) | 人造向量/分数验证门控、并集、fallback、缓存隔离、并行及耗时字段 | 实机 p95、真实 embedding/rerank 泛化；名称含 quality/perf 仍不等于线上质量测量 |
| [S/w08-real-eval.mjs:327](../../integrations/sillytavern/scripts/w08-real-eval.mjs#L327)、`:507`、`:584` | 已有真实提取与本地模型评测脚手架，判断 recall block 的关键词/禁止词、纠正与遗忘；提问阶段关闭提取，防污染 | **没有完整前台模型答题 + 独立 LLM 评审闭环**；其 outboundSurface 是 `st-memory-recall-block`。`:339` 还列跨账户、噪声等未覆盖项 |
| `scripts/perf-send-stages.mjs:103`、`:155` | 本地真实 embedding/rerank 冷热测量与缓存统计；候选存储/检索部分是替身 | 浏览器首字、用户发送到显示、整条 Go/Node/PG 路径；此脚本会卸载本地 embedding，不能默认指向共用实例 |
| `integrations/sillytavern/desktop-ui/tests/chat/`、`tests/memory/` | 组件/状态/交互回归，部分窗口行为 | 网络下的开聊时延、长列表帧率、跨设备收敛与真实模型质量 |

历史质量基线必须保留原意：[UX-11 本地测试报告](2026-11-01-ux11-local-test-report.md) `:47` 最初未运行真实模型；后续 `:222` 三条真实样本通过，`:223` 记录60次调用、181,950输入/39,232输出 tokens、正向召回6/8、负向6/6，流程 PASS 不代表语义全过。`:235` 修复含“阅读计划”的 M09 改写问；`:236` **“我们上次谈到哪一步了？”M09-direct 仍失败**；`:247` 的22个负例不是22个端到端空召回。本文没有复跑这些结果。

优先诊断链为：来源是否进入提取 → L1事实是否存在 → 合法候选是否存在 → 检索/rerank是否保留 → 最终出站是否包含 → 回答是否正确。M09-direct 首先需要有来源约束的近期主题消歧实验，不能简单降低全局阈值或把明确改写问替换掉原失败题。

## 2. 指标脚本设计：先知道时间花在哪里

### 2.1 口径与建议目标

以一次用户动作作为逻辑 `sample`，其内部重试/工具续轮作为 `attempt`。浏览器使用 `performance.now()`；Node 使用 `performance.now()`/`hrtime`；Go 使用带单调时钟的 `time.Now()/Since`。各进程只计算自己的 duration，禁止跨进程墙钟相减。用每轮临时随机关联号连接 span；关联号不作为 Prometheus label，不持久化真实账号/会话标识。

| 指标 | 起止点、失败定义 | 首版建议目标（待首次基线校准，非实测） |
| --- | --- | --- |
| 用户感知首字 `ttft_visible_ms` | 有效发送动作→首个**可见正文字符**完成显示；不把响应头、SSE role/心跳、reasoning、空助手节点、typing动画当首字 | 固定真实模型/非长思考档：p50≤1.5s、p95≤3s；同时报告冷模型结果，不混入暖态 |
| 模型首字 `ttft_upstream_ms` | Node 实际发出 provider 请求→首个正文 delta；另记 first_byte、first_reasoning | 用于解释 provider 部分；不能替代上一行 |
| 完整回复 `reply_complete_ms` | 发送→最终可见文本完成，包含重写/续轮/气泡调度；另报 `reply_durable_ms` 到保存ACK，保存失败不算成功 | 固定≤512输出tokens的短聊天 p95≤15s；末个正文delta→最终显示 p95≤150ms；末delta→持久化ACK p95≤500ms |
| 打开聊天 `open_paint_ms` / `open_ready_ms` | 点会话→目标尾部/保存阅读锚点有内容并完成显示；以及→可安全发送。空态独立；不能以路由已切换、骨架或旧会话残影当成功 | 暖缓存 paint p95≤250ms；本机冷开按20/200/2,000/20,000条分别≤0.8/1/1.5/3s；迁移后争取所有档尾页≤1s |
| 发送到显示 `send_echo_ms` / `send_ack_ms` | 发送→自己的气泡显示；发送→保存ACK。前者才是“点发送有反应”，后者才允许标“已发送” | echo p95≤100ms；本机无故障ACK p95≤500ms。弱网ACK单列，不能把pending伪装成已发送 |
| 错误率 | 未预期失败的逻辑发送 / 有效发送；同时列打开失败、HTTP/provider失败、流中断、空回复、保存失败、记忆降级率及 attempt级重试 | 无故障合成样本0；真实评测非预期失败≤1%，小样本同时列失败数/分母，不只写百分比 |

授权拒绝、预算熔断、用户取消、无效输入、允许的沉默各有封闭 outcome；它们不冒充成功，也不与网络错误混算。已接受的发送如果超时，保留耗时下界和 timeout 计数，不能删掉后只算成功样本的“漂亮 p95”。有效沉默只接受程序明确记录的决定，不把空回复错误改名为沉默。

聊天长度用**持久化消息条数**分档：0、20、200、2,000、20,000；同时记录序列化字节数、历史token数、纯文本/富消息占比。每档测试冷浏览器启动、已启动首次开聊、切回已缓存聊天、搜索定位四种状态；模型冷/暖与页面冷/暖是两组不同维度。初始数据统一为合成中文消息；富卡/图片/iframe另组，不能混入纯文本速度结论。

### 2.2 打点位置与复用

| 层 | 具体打点处 | 输出与限制 |
| --- | --- | --- |
| 浏览器输入/切换 | [D/features/chat/useComposer.ts:62](../../integrations/sillytavern/desktop-ui/src/features/chat/useComposer.ts#L62) 有效提交；[D/runtime/session-bridge.ts:965](../../integrations/sillytavern/desktop-ui/src/runtime/session-bridge.ts#L965) open开始、`:1141` readChat前后、`:1278` ready；[X/desktop/standalone/session.js:254](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L254) 用户消息准备/发布、`:262` 保存ACK、`:280` prompt准备 | User Timing marks + 有界内存buffer，脚本结束一次性取走；目标消息key只在内存匹配，产物转为合成sample序号 |
| 浏览器流/绘制 | [X/desktop/standalone/session.js:289](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L289) 请求、`:310` onUpdate、`:333` 最终回调、`:339` 保存；[D/features/chat/MessageLeaf.tsx:16](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageLeaf.tsx#L16) 挂载叶子；[X/desktop/standalone/cards/index.js:146](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/cards/index.js#L146) 实际叶子更新；[D/features/chat/MessageList.tsx:270](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageList.tsx#L270) 列表commit | MessageLeaf按key挂载，不能只盯React重渲染；在叶子渲染owner记录正文更新。commit不等于paint：可见且文档前台时，用更新后的rAF/下一帧作“显示机会”代理，真实浏览器校验；不声称获取了硬件屏幕扫描时刻，后台tab单列 |
| Node前台 | [N/lib/memory-guard.js:135](../../integrations/sillytavern/server-plugin/virtual-companion/lib/memory-guard.js#L135) 已有 `memory_recheck_ms`；[N/lib/model-usage.js:114](../../integrations/sillytavern/server-plugin/virtual-companion/lib/model-usage.js#L114) reserveSend，实际provider fetch前后及流解析/结算路径 | 分开 source核对、二次召回、用途解析、预算预留、provider首字/末字、结算；只记录duration/计数/封闭错误码，不落请求或响应体 |
| Go召回/作业 | [B/httpapi/st_memory.go:17](../../backend/internal/httpapi/st_memory.go#L17) handler已有 auth/context/source/engine/recall 和各检索阶段日志，`:76`汇入metrics；[B/jobs/memorycore_extract.go:28](../../backend/internal/jobs/memorycore_extract.go#L28) 排队/提取/发布/画像完成；[B/memorycore/callback.go:183](../../backend/internal/memorycore/callback.go#L183) 预留、`:204`provider、`:234`记账 | 在现有结构扩充排队、持久化和错误结果，复用 [B/observability/metrics.go:29](../../backend/internal/observability/metrics.go#L29)、`:110`；Go provider耗时标为记忆后台用途，不错当桌面前台 |
| MemoryCore | [M/native-engine.mjs:182](../../integrations/sillytavern/memorycore-service/native-engine.mjs#L182)、`:377`已有阶段stats；[M/embedding.mjs:12](../../integrations/sillytavern/memorycore-service/embedding.mjs#L12)缓存；[M/rerank.mjs:150](../../integrations/sillytavern/memorycore-service/rerank.mjs#L150)缓存 | 复用 queryEmbedding/looseRetrieval/originalGate/keywordRecovery/rerank/summaryProfileGate。阶段有重叠，**不能相加后当端到端时间** |
| 账本 | [B/store/postgres/memorycore_call.go:19](../../backend/internal/store/postgres/memorycore_call.go#L19) 记忆调用持久化；[B/store/postgres/model_usage.go:125](../../backend/internal/store/postgres/model_usage.go#L125)前台结算、`:178`UNKNOWN/NOT_SENT；`N/lib/model-usage.js`适配 | 记录用途、真实计费输入/输出/缓存token、调用数、known/unknown费用；计量关联失败显式标记，不按调用返回顺序硬凑 |

当前 `gen_started` 在 response 已返回后才写（`session.js:301`、`:304`），不适合回推首字或完整发送耗时。[B/observability/metrics.go:164](../../backend/internal/observability/metrics.go#L164)、`:284`已有累计计数/耗时和，**没有能直接给出这些端到端 p95 的样本分布**：低基数聚合继续复用，精确分位数由本次脚本的逐样本文件计算；需要线上分布时才在同一个 Registry 增加有限bucket，不部署新监控服务。

### 2.3 脚本、结果和每次改动后的比较

`scripts/perf-send-stages.mjs` 的 CM-1 入口（2026-11-07）：

- `--mode browser --round round-<name>`：真实 Chrome + 本机分块 SSE 的采集器校准，默认 0/20/200/2,000/20,000 条持久化合成消息 × cold-browser/first-open/warm/search，冷/首次各30次、暖/搜索各50次；`--histories`、`--cold-runs`、`--warm-runs` 可用于定向复核。结果标为 `collector-fixture`，不是生产桌面速度基线；token 数为合成码点计数。采集器可在隔离桌面测量适配器中通过 `installChatMemoryProbe` 接入真实事件与消息叶子。
- `--mode pipeline --dataset <numeric-samples.jsonl> [--baseline <previous-samples.jsonl>]`：读取隔离评测采集的数值行，输出分组分位数、失败分母和配对差值/95% bootstrap区间；这个命令本身不发模型请求。真实评测出口与数据来自 CM-2/3。
- `--mode local-model --dedicated-local-models --label <name>`：沿用原局部模型测量；必须明确声明专用实例才允许卸载 embedding。不提供 mode 不会进行网络访问。`--output <directory>` 可指定本轮产物根目录。

回复指标由 `createReplyQualityMetrics` 采集、`summarizeReplyQuality` 汇总。重叠率定义为当前最终回复的不同 Unicode 码点 3-gram 中，曾出现在同会话此前至多3条助手回复里的比例（保留标点/空白；无可比历史或不足3字为无样本）。首次候选/最终回复的规则硬命中与软命中分开计数，分母只含实际执行规则的回复；重写耗时从首次要求重写到第二候选完成判定，仅成功结束的重写进入耗时分布。独立桌面现未执行旧 ST 的 `planReplyAction`，其规则/重写指标必须标 `inactive`，不能以零命中表示质量通过。

每次涉及聊天渲染/存储/召回的改动后：

1. 锁定 baseline SHA与candidate SHA、浏览器构建、机器/并发、网络档、模型用途快照、token上限、embedding digest、rerank开关/阈值、数据seed/hash。两版本按AB/BA顺序交错，减少热身与时段偏差。
2. 零费用UI模式各档暖态至少50次、冷启动至少30次，热身另记；真实模型模式使用本轮评测回答样本，不另外无限扩样。给 p50/p95、样本数、失败数、配对差值及bootstrap置信区间；n不足不报p99，不据20个样本承诺99%可靠性。
3. 实时模型/记忆改变执行§3固定core集；只改UI先比较UI指标，保留已有模型基线的版本适用说明。全量真实A/B需要重新计价，费用不足就标“不完整”，不能静默删除最慢/最贵类别。
4. 延迟预警：同条件p95比基线增加超过10%且绝对增加超过50ms；错误/零泄漏指标恶化直接失败。首版绝对目标见§2.1；质量门禁见§3.3。基线不自动覆盖，改数据集/模型版本必须新建比较组。

产物放已有忽略目录 `integrations/sillytavern/.local/chat-memory-quality/<round-id>/`：`manifest.json`、`samples.jsonl`、`summary.json`、`comparison.md`、`budget.json`。JSONL每行一动作/阶段，示例仅展示结构，数字不是实测：

```json
{"schemaVersion":1,"round":"synthetic-r1","variant":"candidate","case":"single-001","historyMessages":200,"cache":"warm","metric":"ttft_visible_ms","value":1200,"outcome":"ok","attempts":1}
```

manifest存非敏感版本指纹、随机种子、计价/汇率来源日期、运行环境和计划/已完成样本数；samples存计数、时长、合成fact/case ID、封闭失败原因。禁止正文、prompt、response、Cookie、Authorization、私有base URL、真实稳定标识进入日志、截图、HAR或trace。测试答案/判断所需文本只在运行内存中处理；能重建的合成输入放临时目录，不复制业务聊天。

文件目录0700/文件0600；创建入口实施保留上限：最近10轮且不超过30天、总量≤200MB，另外保留一份脱敏基线manifest/summary≤10MB。到容量上限先清理可淘汰旧轮，无法安全清理则拒绝创建；失败/中断同样有摘要。只删除本脚本拥有且标记一致的目录，临时数据、进程和卷成功/失败/SIGINT都定向回收。完整模型输出不以“方便debug”为由保留。

## 3. 记忆评测：真实模型、合成长对话、分层归因

### 3.1 题型与数据生成

借鉴 [LongMemEval](https://arxiv.org/abs/2410.10813) 的事实提取、跨会话、时间推理、知识更新和无法回答时克制，以及 [LoCoMo](https://aclanthology.org/2024.acl-long.747/) 的长跨度多会话与基于人物/事件图的生成方法。仅借鉴任务结构，**不声称本项目分数可与其排行榜比较**；不导入真实人物对话。遗忘与实例隔离是本产品额外的硬边界题。

| 主类别（core每类20题，共140题） | 生成与判分重点 |
| --- | --- |
| 单会话事实 | 明确事实、偏好、约定，直接问/同义改写各半；含长期事实与纯短暂状态对照。答案必须来自用户来源，不从助手自述推断 |
| 跨会话 | 两个或更多会话共同构成答案；早/中/晚证据位置均衡，话题干扰。纳入M09式纯指代与含主题词配对问；有足够近期上下文时应消歧，多主题不明确时应澄清 |
| 时间推理 | 固定来源时区/时间，先后、间隔、日期更新、跨午夜/月年/DST；明确时间与应澄清时间分开。计划不算完成，使用询问时点可知事实 |
| 更新与纠正 | 自然语言改口、手动expectedVersion纠正各半；当前值正确，不能继续推荐旧偏好；“当时是什么”可按有效期查询历史，不能粗暴禁止一切旧值 |
| 遗忘后不应召回 | 删除前命中作正对照；begin后、cleanup DONE后、重启后、旧请求迟到后查询；旧事实L1/L2/L3/最终prompt泄漏均失败，PARTIAL不是完成 |
| 实例隔离 | 同owner不同relationship、同角色不同instance、不同owner、COMPANION/STORY的同词异值；正确实例有证据，对照实例不得获得该事实；置顶不能越权 |
| 拒答/澄清 | 从未提供答案、只给模糊日期、矛盾无法消解、被删除/不可访问的证据；允许简短“不确定/不知道”或澄清，禁止猜一个合理值。这里测知识不足的克制，不是把一般陪聊拒绝掉 |

拟在现有 `scripts/eval-memory.mjs` 增加生成与真实评测模式，复用 `S/w08-real-eval.mjs` 的夹具/结果封存纯函数，移除对旧私有文件加载器的依赖；不注册新的受管场景。默认仍为离线模式，真实模式必须显式选择并通过预算预检，不挂到 `scripts/check.sh` 的日常自动检查中。

生成算法：固定PRNG算法与版本，例如xoshiro128**；开发seed=`20261106`，独立验收seed=`20261107`，每个case从seed+caseId派生子种子。先生成合成事实表与事件图（factId、scope、subject/predicate/value、sourceTurnIds、validFrom/validTo、supersedes、forgottenAt），再用模板与有限同义词词表渲染对话，最后从图生成问题/答案/证据集合/禁止事实。固定UTC基准和IANA时区，避免依赖机器“今天”。姓名、地点、偏好来自虚构词表；不从仓库业务数据、日志或Owner聊天采样。

默认core：2个合成owner×每owner2个instance；每个instance跨10次会话、共200条消息（100条用户来源），合计800条/400用户来源；日期覆盖约90天。历史助手文本为固定模板，生成数据本身¥0。所有符合产品提取条件的用户来源均走真实提取，不预填gold记忆、不用stub提取结果。另生成600与2,000条的长历史档、远距离证据、相似实体/日期与事实噪声；长档单独预注册运行配方，预算不足不得冒充core全覆盖。建议首个长档用“主实例600条+其余3实例各80条”，420个用户来源，费用接近core；2,000条档先dry-run计价。

数据可字节复现：记录generator版本、seed、模板hash、事实图hash、对话hash。真实模型输出只能尽量复现，固定model revision、采样参数、推理档和prompt hash；不把temperature=0等同于确定性。开发/校准集用于调阈值，验收集不参与调参；现有rerank校准100问继续保留，不能挪作盲测成绩。

### 3.2 运行方法与隔离

后续真实运行使用独立项目名/端口/PG数据库与卷、ST数据目录、MemoryCore目录、合成账号、浏览器profile及专用本地embedding/rerank实例；不连接开发/生产库、不复用Owner聊天目录。沿用 `S/lib/paths.mjs` 与现有隔离栈生命周期；每次启动核对本轮资源标记，结束清理覆盖临时卷。**本轮仅设计，不启动这些资源。**

provider继续通过现有管理接口与用途解析配置：提取绑定 `MEMORY_EXTRACTION_DEDUP_SUMMARY`，答题绑定 `FOREGROUND_CHAT`；冻结provider/profile revision、协议、modelId、sampling/reasoning上限。judge使用独立合成评审账号的 `FOREGROUND_CHAT` 绑定，经现有Node生成/provider适配入口调用，关闭该账号的记忆提取和注入；它与被测账号共享本轮预算出口。`evalRole=judge`只是测量标签，不新增产品purpose，也不能让评审文本成为被测记忆来源。

测试环境由现有部署配置在进程启动时注入凭据，脚本只持有配置引用/本轮授权能力，不读取或打印秘密。已有 [S/w08-real-eval.mjs:258](../../integrations/sillytavern/scripts/w08-real-eval.mjs#L258)、[S/w08-real-accept.mjs:37](../../integrations/sillytavern/scripts/w08-real-accept.mjs#L37) 会读取旧私有文件，**不能直接照搬该入口**；本文只查看了加载器源码，未读取其目标文件。先完成配置引用与预算接入，再允许真实运行；没准备好时返回 `CONFIG_NOT_READY`，不回退去找私有文件。

单轮顺序：

1. 零费用dry-run校验数据hash、可用配置元数据、计价币种/上限、隔离标记、预计样本/调用预算。关闭真实通知、主动问候及无关定时作业，避免串入费用与记忆。
2. 经既有聊天写入/来源核对入口按时间顺序写入历史，等待来源settled、提取终态、发布及画像可用；读取的是本轮测试环境的状态。记录每个fact从来源→L1→L2/L3的覆盖和就绪时延。未提取成功的题保留在端到端分母，不能直接跳过。
3. 查询阶段停止新的历史写入；每题用同实例的干净查询会话/等价可复原状态，近期上下文只给题目所需的受限窗口。禁止把全部历史塞进答题prompt绕过记忆。隔离问答来源的提取，防止第1题答案污染第2题；该控制行为与正常产品路径的差异写入manifest。
4. 先读合法检索候选与最终排序，再走实际桌面/Node出站路径。运行内存中校验最终序列化请求的记忆块、来源集合与token裁剪；仅输出fact覆盖/数量/失败码。API block有答案、出站没有答案时判注入失败，不算回答模型失败。
5. 真正让前台模型答题；评审器只读问题、图生成的gold/rubric、必要gold证据和答案，不知道baseline/candidate标签，不依据候选系统自己的记忆解释打分。
6. 纠正/遗忘题在明确状态点执行；包括begin返回后禁止被忘记忆进入新的出站、DONE后清理、重启、在途提取完成后的检查。已在遗忘前发出的provider请求无法撤回，单独记录边界时序；不得把遗忘后的新泄漏归到这个例外。

遗忘分成两个明确轨道：正式的 `memory-only` 题用干净查询会话，原事实不在近期历史中，检查最终prompt和答案零泄漏；额外的 `history-visible` 诊断保留原历史，检查是否通过历史再次回答。后者不能被前者的通过覆盖，单列其泄漏次数；在Owner确定§6的产品语义前，不宣称已实现“全上下文遗忘”。同理，拒答/隔离题必须检查prompt中没有因夹具错误意外提供gold。

设置三个诊断对照：memory-off、gold-evidence（只为判断读者模型上限）、真实管线。默认全量跑真实管线；两种对照各取固定分层小样本，或复用兼容基线。对照额外调用同样扣本轮预算，不能用gold-evidence的分数替代产品分数。

### 3.3 指标、规则与 LLM 评审

检索的gold单位是**原子事实/证据集合**，不是数据库随机ID。一个提取记录可映射多个fact，多个记录可覆盖同一fact；映射先用来源、规范化实体/数值/日期和同义词规则，不明确时由固定评审器判定并记录 `mapping_uncertain`。不能仅凭相同source ID就断定事实正确，也不能因摘要使用同义词判漏召回。

| 指标 | 精确定义与报告方式 | 首版建议门槛 |
| --- | --- | --- |
| 提取precision/coverage | 输出事实中有来源支撑的比例；应长期保存事实被L1覆盖比例；另计短暂状态误存、助手事实污染 | precision≥95%；coverage先建基线，错误类型逐类不被平均数掩盖 |
| retrieval recall@1/5/10/20 | 每题 `被前k条覆盖的gold事实数 / gold事实数`，再macro平均；跨会话另报全部必要证据同时命中率 | recall@5≥90%、@20≥95%；报告SQL合法候选、原检索、并集/置顶最终排序各层 |
| 条件检索 vs 全链路检索 | 条件指标分母限已提取且合法的gold；全链路指标保留提取失败。无答案/遗忘题gold为空，不塞入recall分母 | 两者并列；禁止只公布条件指标 |
| 注入命中 | 最终provider请求中覆盖的gold比例，以及“全部必要证据均在实际出站记忆块中”的题数比例；另报相对检索命中的丢失率、无关注入率 | 全部证据注入率≥90%；遗忘/越实例事实注入=0 |
| 端到端答对率 | `规则通过且LLM judge判正确的题数 / 全部计划题数`；展示可回答题准确率、7类macro及全题分数 | 可回答题总体≥85%，每类≥75%；不是替换现有零泄漏硬门槛 |
| 纠正/遗忘/隔离 | 当前事实正确率；旧值当当前值率；遗忘复活、跨scope泄漏、清理DONE后残留次数 | 纠正当前值≥95%；遗忘/隔离/复活次数=0；发现一次即阻断质量通过 |
| 拒答/澄清 | 不可回答题正确克制率，同时看可回答题误拒率；猜中gold但无合法证据也失败 | 正确克制≥95%；可回答误拒≤5% |
| 时延/成本 | 保存→L1可召回、画像可用，recall/最终注入/TTFT；各阶段tokens、费用/成功题、未知用量与估算口径 | 建立召回p50/p95及首字基线，首字退步>20%标明取舍；不设金额上限，单轮token超过冻结正常完整轮参考2倍自动停止 |

规则先验收确切日期/数字、当前值、禁止事实、scope、删除状态、证据覆盖、结构与预算；规则失败不能被LLM“感觉不错”覆盖。对日期不默认±1天宽容，只有gold明确允许的口语精度可放宽。LLM输出固定结构 `{correct, grounded, abstains, reasonCode}`；reasonCode来自枚举，禁止自由文本把答案抄入日志。额外记录自然度、是否机械复述记忆，先作诊断项，不让风格分抵消事实错误。

评审偏差控制：优先使用不同于被测提取/回答模型的已配置judge；若只能同模型，标明相关偏差。随机打乱A/B顺序；固定10%分层样本二次盲评及人工复核，规则/LLM冲突样本单列。人工复核在隔离本地视图即时展示合成文本，不保存来源正文或截图。本次重评入口仅将合成被测输出留在本机0700目录/0600私有答案缓存，按既有轮次/容量/期限回收；不进报告、日志或提交，不能用于真实对话。初始报告judge一致率与人工一致率；一致率低于90%时先修rubric，不拿不稳定judge调检索阈值。

置信度与完成状态：每类20题的置信区间很宽，报告分子/分母、Wilson区间和配对bootstrap差值；统计未分出优劣就写“不确定”。零泄漏只表示所测样本零次，不承诺总体绝对不会泄漏。任一类别观测退步均标红；必要的定向复测仍计同轮预算。budget_stop、超时、未就绪、judge失败保留计划分母，并同时给已执行成绩和覆盖率；**只有覆盖100%、预算及门禁均满足才能标完整通过**。

### 3.4 历史 CNY 上限工具：计价、预留和熔断

本节为此前每轮 ¥100 的设计与兼容工具说明。Owner 2026-11-07已取消本次真实评测金额上限，当前运行改用持久 token 计量与冻结正常完整轮参考的两倍异常停止；不能将本节旧限额或旧账本累计量当作当前停止条件。价格存在时仍报告折算费用，缺少实际单价时如实标未核价。

CM-2 已提供 `node scripts/eval-memory.mjs --mode preflight --config-ref local-catalog --round round-<name>`：只读本机现有用途绑定与私有解密配置，不读业务对话、不发模型请求。默认 CNY 模式缺价格拒绝；`--quote-file` 可引用含 provider/profile、真实单价、日期、其他收费界限及 reasoning 计费输出上限声明的报价文件。Owner 本轮授权的 token 模式需同时显式传 `--budget-mode tokens --owner-token-only`，不声明 CNY 上限通过。

`createRoundBudget` 以整数微元预留并 fsync，恢复时把在途项保留为 UNKNOWN，固定 round/模型/报价/额度，禁止通过续跑清零或换快照；损坏账本拒绝打开。`startEvaluationMeter` 只给隔离调用者本机 URL 和随机本地能力凭据，真实上游凭据只在出口进程内；当前验证协议为 OpenAI Chat Completions 文本/函数工具，其他协议明确拒绝。出站观察以预留 ID 对齐账本，不按返回次序关联。SSE 逐块转发，缺 usage / 断流 / 结算失败不释放上界；响应原始 cost 字段不冒充 CNY。

静态 `specs/catalog/model-purposes.yaml` 定义用途，未提供本轮provider/model的数值价格。尤其 `specs/catalog/model-ledger-price-statuses.yaml:4` 与 [B/store/postgres/model_usage.go:95](../../backend/internal/store/postgres/model_usage.go#L95) 明确：缺价格/非USD时可以发请求，fee为null。它与 `model-purposes.yaml:17` 的“缺价格不调用”说明存在口径差异。**本轮不改契约，也不能把现有月度账本当作评测硬上限。** 评测入口应更严格：价格、币种或计费token上界未知就不发真实调用。

复用 [S/lib/real-model-meter.mjs:58](../../integrations/sillytavern/scripts/lib/real-model-meter.mjs#L58) 的短命本机meter作为所有本轮付费请求的共同出口，不新增常驻服务；补齐流式转发与原子预算。旧实现 `:63` 按已完成calls.length挡请求，`:91` 先读完整响应，既存在并发在途超支窗口，也会破坏TTFT测量。新模式必须**调用前先预留**，逐chunk转发并只在内存解析usage；不能用该旧缓冲代理测用户首字。

预算算法（金额用整数微人民币，避免浮点累计）：

```text
round_cap = 100_000_000 micro-CNY
committed = settled_known + unknown_upper_bound + in_flight_reserved
request_upper = ceil(input_token_upper * peak_uncached_input_price
                   + billable_output_token_cap * peak_output_price
                   + bounded_other_fees)  # 单位换算后向上取整
if committed + request_upper > round_cap: 不向provider发包，BUDGET_STOP
else: 原子持久化reservation → 发送 → 结算或保留UNKNOWN上界
```

- 一个round包含数据模型化（如启用）、L1/冲突/L2/L3的所有工具续步、画像/遗忘重建、前台回答、自动重写/工具轮、judge/二审、探针、A/B和失败重试。baseline已有兼容结果可以复用；若重新跑baseline，**两版本共享同一个¥100账本**。恢复进程/续跑不得换round清零。
- 预留用实际provider协议的完整输入token上界和**请求允许的最大计费输出**，包含reasoning；不能用平均700 tokens或“中文字符/4”作硬保证。优先用已验证tokenizer/计数接口；无安全计数时用已验证模型context上界作保守预留，不知道上界或provider不强制输出cap则拒绝启动。请求不允许自动切到更贵模型、协议、工具或无限重试。
- 价格快照锁定实际provider+model版本、币种、输入/缓存/输出/推理/其他收费；预留按高峰未缓存价格，不赌缓存或低峰。用USD时另有Owner认可的保守CNY/USD结算上界及支付加价；无法界定汇率/费用则不运行。现有USD产品账本照常结算，评测CNY账本另作核验，不能把官方CNY价伪装成产品USD价。
- 并发默认1，预算预留仍需互斥和落盘；未来并发同样先hold后发。成功有可靠usage后按快照结算释放差额；未发包可释放；超时/断流/无usage/结算失败保留整个上界，不当零元。重试另占hold，旧UNKNOWN不释放。SDK内部自动重试必须关闭或每次经过同一guard。
- ¥80发出预算预警，并停止启动无法完整完成的下一组；¥100是不可越过的准入上界，不是达到100再杀请求。运行前用小批合成来源测实际调用放大率，消耗计入同round；用剩余额度估算是否能完成预注册整组。预算不足标 `BUDGET_STOP / INCOMPLETE`，保留诊断，不把已过子集报全绿。
- 测试stack中的Go/Node/评审器只能经该本轮出口使用外部凭据；禁止另一条直连绕过预算。复用provider适配配置时保留协议和模型映射，meter不得输出Authorization或私有端点。退出时关闭出口、停止本轮作业，已发请求按预留承担最坏费用；重启从持久化journal恢复UNKNOWN。
- 后续验收先用替身做并发、重试、崩溃、未知usage和计价缺失故障注入，指标是“超限准入次数=0、绕过出口次数=0、UNKNOWN错误释放次数=0、账本差额=0”。硬上限只建立在核实的provider收费与token边界上；不满足即零真实调用，不能用20%余量冒充保证。

### 3.5 每轮费用估算（模型选择示例，不代表现有私有provider报价）

2026-11-06查阅 [DeepSeek官方人民币定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：`deepseek-flash` 高峰未缓存输入¥2/百万tokens、输出¥8/百万；`deepseek-v4-pro` 为¥9/百万、¥27/百万。下表统一按高峰、无缓存优惠估算；以Flash做提取/回答、Pro做judge示范。旧评测绑定的是带中转前缀的modelId（[S/w08-real-eval.mjs:20](../../integrations/sillytavern/scripts/w08-real-eval.mjs#L20)），**官方直连价格不能证明该中转价，也不意味着这些模型已在测试环境配置好**。

| core候选单次运行 | 估算量（调用均含在本轮） | 输入/输出token合计 | 费用 |
| --- | --- | --- | --- |
| 400条用户来源的L1/冲突/L2/L3 | 暂估每来源6次调用，每次3,000输入/700输出；真实放大率由试跑校准 | 7,200,000 / 1,680,000 | ¥27.84 |
| 140题前台回答 | 每题4,000输入/512输出 | 560,000 / 71,680 | ¥1.69 |
| 140题Pro评审 | 每题1,500输入/256输出 | 210,000 / 35,840 | ¥2.86 |
| 纠正/遗忘画像额外预估 | 40次Flash调用，每次3,000/700 | 120,000 / 28,000 | ¥0.46 |
| 10%二审 | 14次Pro，每次1,500/256 | 21,000 / 3,584 | ¥0.29 |
| 合计 | 2,734次调用的容量估算，**不是现有callCap** | 8,111,000 / 1,819,104 | **约¥33.14** |

规划预留20%用于探针、少量对照、失败与波动，建议候选一轮准备**约¥40**；需要同轮重新跑baseline+candidate时约**¥66–80合计**，仍共用¥100熔断。平均输入/输出是预测，不是上限：画像增大、reasoning=max、工具循环或中转加价均可能令完整core超过预算，届时应在启动前选择较小且七类均衡的独立配方，或停止为不完整结果，不能降低预留或借下一轮额度掩盖。

本地embedding/rerank API费用为“不计外部token费”，仍记录调用数、时延和资源消耗，不将其写成已知零美元在线账单。全Flash judge会更便宜但偏差更相关；不同provider必须用其实际报价重算。历史60调用的token数仅用于估算单次量级，不能直接线性外推长画像成本。**本轮文档任务实际模型评测费用为¥0。**

## 4. 对话体验差距与收益/成本排序

成本是相对实施量级（小/中/大），不是工期承诺。优先级先保障正确性和日常高频操作，再扩展同步。所有验收仍以§2指标与数据一致性计数为准。

| 参照手感 | 当前实现（文件:行） | 差距与建议 | 收益 / 成本 / 优先级 |
| --- | --- | --- | --- |
| 秒开、本地历史缓存 | [D/runtime/session-bridge.ts:974](../../integrations/sillytavern/desktop-ui/src/runtime/session-bridge.ts#L974) 合并同目标在途请求、当前ready会话直接返回；`:1081` 切换后清消息；`:1141` readChat整份读取；[D/data/queries/chat.ts:120](../../integrations/sillytavern/desktop-ui/src/data/queries/chat.ts#L120) Query缓存主要用于列表/角色/关系 | 没有已建立的持久化消息尾页缓存/离线开聊。先测整份读取、运行时准备和渲染各占比；先做有界内存尾页缓存，缓存可读与revision核对后可发分开。持久化缓存按账号/实例隔离、登出/删除失效；稳定消息ID/分页API到位后接IndexedDB | 高频高收益 / 中 / P1；Go+PG稳定分页后完成网络与解析规模优化 |
| 乐观发送、失败重试 | [D/features/chat/useComposer.ts:62](../../integrations/sillytavern/desktop-ui/src/features/chat/useComposer.ts#L62) 防重复提交；[X/desktop/standalone/session.js:257](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/session.js#L257) await userMessage后先publish、再save，已有乐观显示；`:373` 未保存回填草稿；`:672`重试；[D/features/chat/MessageList.tsx:333](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageList.tsx#L333)notice/重试 | 不是“没有乐观发送”，而是缺按消息持久化的pending/failed/ACK证据和耐刷新outbox；部分错误用会话notice/blocked表示。先保证100ms echo、ACK前不显示已发送、重试无重复用户消息；持久化outbox须依赖服务端幂等messageId/ACK | 高频高收益 / 中 / P1；UI状态先做，耐刷新outbox依赖迁移写入语义 |
| 正在输入与流式 | `session.js:234`busy，`:236`60秒慢提示，`:310`清洗文本增量publish；[D/features/chat/MessageList.tsx:333](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageList.tsx#L333)正在回复；[D/features/chat/MessageItem.tsx:103](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageItem.tsx#L103)streaming样式 | 真实流已存在；状态仍主要反映busy，不区分保存/召回/provider等待/首字/收尾。测首字“可见正文”、停流反馈、流式帧长任务；技术阶段留在诊断，不向普通用户展示内部流水线 | 高收益 / 小至中 / P1；不依赖迁库 |
| 拆条气泡与节奏 | [X/reply-pipeline.js:105](../../integrations/sillytavern/extension/vc-model-settings/reply-pipeline.js#L105)最多3段、`:135`首段350ms/总8s上限；[X/desktop/standalone/cards/index.js:166](../../integrations/sillytavern/extension/vc-model-settings/desktop/standalone/cards/index.js#L166)实时回复传入非reducedMotion；`reply-bubbles.js:207`定时显示。`session.js:333`设置liveReply后进入最终回调 | 与UX-23“不加拟人延迟”存在可定位差异：实时回复仍可能在最终渲染分段等待，历史/减弱动态立即展示。沿用已有决定，桌面先保证流式内容不回退/不重复等待，保留按句拆条；不要为“像人”额外拉长TTFT或末字耗时 | 高收益 / 小 / P1；非新的视觉定稿授权，实施时遵循仓库外观规则 |
| 未读、回到底部、定位 | [D/features/chat/useReadingPosition.ts:408](../../integrations/sillytavern/desktop-ui/src/features/chat/useReadingPosition.ts#L408)本地read/pos恢复，`:442`未读落点，`:598`读位置，`:772`尺寸变化锚定；`MessageList.tsx:320`最新/未读按钮；`ChatRoute.tsx:67`搜索先展开全部 | 单设备能力较完整；read/pos主要为本地楼层值，编辑/删除、全量搜索、跨设备会有漂移风险。[D/data/queries/chat.ts:98](../../integrations/sillytavern/desktop-ui/src/data/queries/chat.ts#L98)列表构造未赋权威unread，不能因某组件有角标就声称全链路已读同步。先测200次跳转/插入/删除锚点误差；迁移后改为稳定消息ID与单调读游标 | 中高收益 / 中 / P2；跨端部分依赖迁移 |
| 长列表虚拟化 | [D/features/chat/MessageList.tsx:46](../../integrations/sillytavern/desktop-ui/src/features/chat/MessageList.tsx#L46)PAGE_SIZE=80，`:179`slice尾部、`:250`手动向前增加，`:270`map全部可见；`ChatSearch.tsx:41`遍历DOM匹配 | 当前是渐进显示，不是虚拟化；搜索/定位可展开全历史，滚动越久DOM越大，网络仍整份。先将纯文本列表改为窗口+overscan、稳定锚点，搜索改为数据索引与按需定位；富卡生命周期要按现有唯一owner规则卸载 | 长聊高收益 / 大 / P1；渲染可先做，分页检索依赖Go+PG |
| 多端同步与冲突提示 | `session.js:88`F2/CAS保存，`:80`阻断冲突并保留快照；[D/features/chat/ConflictSheet.tsx:7](../../integrations/sillytavern/desktop-ui/src/features/chat/ConflictSheet.tsx#L7)查看最新/保留草稿/复制；`session-bridge.ts:1666`重新打开最新 | 已有防覆盖保护，没有由此证明实时推送、断线增量追赶、已读游标同步或自动合并。先测双tab/双合成客户端冲突可恢复、零静默丢消息；迁移后再引入持久化seq/cursor、增量重连、幂等写入，不自动合并任意JSONL快照 | 高频冲突时高收益 / 大 / P2；完整能力依赖迁移 |
| 记忆可解释、可纠正、可遗忘 | [D/features/memory/CorrectMemory.tsx:56](../../integrations/sillytavern/desktop-ui/src/features/memory/CorrectMemory.tsx#L56)冲突内容；[D/features/memory/useMemoryState.ts:487](../../integrations/sillytavern/desktop-ui/src/features/memory/useMemoryState.ts#L487)证据、`:521`遗忘；[D/data/queries/memory.ts:310](../../integrations/sillytavern/desktop-ui/src/data/queries/memory.ts#L310)纠正/缓存失效；[D/features/chat/MemoryInspector.tsx:58](../../integrations/sillytavern/desktop-ui/src/features/chat/MemoryInspector.tsx#L58)空召回/错误、`:84`纠正删除 | 已有操作入口；缺“操作到实际回答改变”的量化闭环。显示清理中/部分失败应与真实状态一致；“本次想起”需关联最终注入，而非任一候选列表；用纠正生效时延/遗忘泄漏数验收 | 信任高收益 / 中 / P0–P1；迁库前可做，来源ID迁移需回归 |

## 5. 工作项拆分与 Go+PG 依赖

先做 CM-1/2/3 建立可信测量和真实基线，再按失败归因优化，最后接入服务端聊天存储迁移。这里的验收不是“增加若干场景并PASS”，而是固定数据上的性能、质量与一致性结果；必要故障测试扩展现有测试入口。

| ID / 优先级 | 交付范围 | 可量化验收 | 依赖与迁移关系 |
| --- | --- | --- | --- |
| CM-1 / P0 | 统一动作/阶段打点，扩展现有perf脚本，生成paired comparison | §2五类指标都有起止与分母；无正文/凭据字段；受控SSE时钟下误差≤1帧+10ms；每档输出n/p50/p95/错误数，冷暖不混 | 无迁移依赖；测量API形状保持，迁移只替换存储span |
| CM-2 / P0 | 配置引用、短命meter、CNY预算预留/恢复/流式转发 | 未知价格零调用；并发/重试/UNKNOWN/重启压力下超额准入=0、费用遗漏=0；计量调用覆盖100%；流式代理附加延迟p95≤20ms（本机替身） | 所有真实评测前置；复用provider与账本，不依赖聊天迁移 |
| CM-3 / P0 | 固定种子事实图、core140题、真实提取→检索→出站→回答→judge基线 | 数据hash重复一致；7类均20题；完整覆盖100%；输出三层指标与区间、费用≤¥100；首次不达质量阈值也如实给失败基线 | 依赖CM-1/2；不以首次基线必须全绿掩盖M09；不依赖迁移 |
| CM-4 / P1 | 根据归因修复指代/跨会话与提取上下文缺口；先试有界近期主题规则，保持无新增planner | M09原直接问与改写问分别报告；有明确前文的指代子集答对≥85%；模糊多主题正确澄清≥95%；总体recall@5≥90%；原22负例不新增泄漏，独立负例同样零越scope | 依赖CM-3；近期来源读取现阶段可适配ST，迁移后换Go读取；不通过全局降阈值达标 |
| CM-5 / P0–P1 | 纠正/遗忘/来源更新从UI到真实出站闭环，补缓存和画像失效遗漏 | 错误scope/已忘事实出站=0；纠正当前值≥95%；begin后新请求不再含旧记忆；DONE后残留/重启复活=0；明确报告cleanup p95及PARTIAL数 | 依赖CM-2/3；先完成记忆域，迁移必须保持source revision/tombstone/id映射 |
| CM-6 / P1 | 首字关键路径优化，区分并行耗时，减少重复计算与不必要UI等待 | 达§2 TTFT/末字目标或相对基线p95下降≥20%，二者分别标明；质量各类不退步；停流UI响应p95≤100ms；重复召回缓存命中与失效正确 | 依赖CM-1/3；现有浏览器+Node双核对保留安全语义；迁移前可完成 |
| CM-7 / P1 | 暖开聊天缓存、消息pending/failed/ACK状态、失败恢复 | send_echo p95≤100ms；暖开paint p95≤250ms；500次保存失败/重试中重复用户消息=0、草稿丢失=0、ACK前误标已发送=0 | 内存尾页/状态无迁移硬依赖；持久化outbox等稳定ID/幂等ACK就绪后做，不另建ST离线写入协议 |
| CM-8 / P1 | 纯文本窗口渲染、搜索按数据定位、锚点稳定，富卡正确卸载 | 20k条纯文本浏览DOM消息节点≤200；滚动帧间隔p95≤32ms；200次prepend/删除/跳转锚点误差≤4px；搜索不使DOM节点无界增长；不同长度开聊指标齐全 | 渲染可先做；稳定消息ID/分页是完整方案依赖；富卡分组验收，不用纯文本成绩代替 |
| CM-9 / P2 | 服务端迁移接口适配与多端一致性 | 迁移前后同dataset检索/注入/回答无类别退步；每条来源映射可追溯；500组并发编辑/重发零静默丢失与重复；断线恢复后seq收敛100%；本机重连收敛p95≤2s | 依赖迁移提供下列能力；本文不实施Go+PG迁移本身 |
| CM-10 / P2 | 扩大长历史/独立seed、judge校准及长期趋势 | 600条长档完整覆盖，盲测各类达§3门槛；长档与core分别比较；judge人工一致率≥90%；任何一轮预算≤¥100、产物保留符合容量上限 | 依赖CM-3及主要质量修复；2,000条档先计价，不以缩减题型换“全通过” |

服务端迁出（聊天存储改Go+PG）应向本计划提供四项能力，不在这里另建迁移路线图：

1. 稳定的 `conversationId/messageId/revision`、显式幂等发送键与持久化ACK，保留原ST来源ref映射和分支/候选含义。相同重试只能产生一条用户消息/一次相同来源提取。
2. 按游标取尾页/前页、增量变更序列与删除tombstone，使缓存、虚拟列表和搜索定位不依赖可变楼层或整份JSONL；纯存储换PG而继续全量返回，不会自动秒开。
3. 原子消息保存与来源可见性、纠正/删除失效信号；记忆合法候选与最终出站仍核对版本。迁移期间单一写入owner，不把ST和Go做成相互覆盖的双主。
4. 账号/实例边界内的同步cursor和读游标、冲突返回及重连补偿；先保留用户草稿，再显式解决冲突，不能靠最后写入覆盖获得“无冲突”成绩。

迁移前后对比使用同一合成事件流和已锁定配置。保留迁移前基线，迁移版本另列 `chatStore=st-jsonl|go-pg`；重测冷开、发送ACK、来源就绪、遗忘竞态和跨实例，不把模型/数据/存储三项同时换掉后归因给单一改动。

### 5.1 记忆路线评估（总调度，Owner 2026-11-06 同意）

- 保留：抽取事实 + 向量 / 全文混合检索 + rerank + 预算注入；Go 侧来源、纠正、遗忘门禁；本地 `qwen3-embedding:0.6b`（1024 维）与
  `bge-reranker-v2-m3`。embedding / rerank 模型先不换，只做低成本调优（查询任务指令前缀是否已用、rerank 候选数与跳过条件），
  模型对比在 CM-3 评测就绪后用同一数据集进行。
- CM-4 优先：提取由单条用户消息改为最近几轮窗口（含助手确认）；召回查询用最近 2–3 轮补全指代（M09-direct）；
  确认并合并浏览器拦截器与 Node 出站的重复召回。每项改动用同一评测对比，不退步。
- L2 场景 / L3 画像的多步模型循环按评测收益决定保留、简化为定期摘要或去掉。
- CM-11：MemoryCore 的双存储（PG + 每账号 SQLite）带来跨库锁序、双处删除与 10 个补丁维护；单人数据量下 pgvector 足够。
  CM-3 基线后评估收编到 Go + PostgreSQL，与 ADR-0013 同方向，由 Owner 决定。
- CM-12 / CM-13（Owner 2026-11-06 追加）：参考外部项目 MuseAI 的思路（该项目无许可证，只借鉴思路，不复制代码或提示词原文）。
  电脑端聊天走浏览器引擎，超出上下文预算时直接丢弃最早消息，会话内没有滚动摘要；`st_memory.go` 的摘要是跨会话的。
  CM-12 作为“简化为定期摘要”的候选方案参与对比。CM-13 在现有规则版去 AI 味（`reply-pipeline.js` 硬违规重写一次）之上补测量：
  重复率（与同会话最近 3 条助手回复的字符 3-gram 重叠，p50 / p95）、各规则命中率、重写占比与额外耗时，评审增加 AI 味维度；
  规则和提示词按数据调整，不为降低 AI 味额外增加默认的二次生成。

## 6. 需要 Owner 决定的问题

这些不阻塞本文完成，也不要求重复批准已给出的“真实评测、每轮¥100”决定；首次真实运行前应明确会实质改变测量或预算的选项。

| 问题 | 建议 | 影响 |
| --- | --- | --- |
| 实际被测provider/model与judge使用哪个配置、价格从哪里来？ | 保持现有主聊天/提取模型；另选已配置且可定价的judge。若为中转，必须用中转实际单价，不能套官方Flash示例 | 决定¥33–40估算是否适用及硬上限是否可执行；未核实前不调用 |
| 首版SLO与质量目标是否采用本文建议？ | 先做一次真实基线，再锁定§2/§3目标；分provider与长度档，正确性零泄漏优先于总分 | 目标尚未承诺为现状；确定CM工作项的完成条件 |
| “忘掉”是否还要求原聊天仍可见时，模型也不得再从近期历史回答该事实？ | 首版最低边界是长期记忆/派生画像/最终记忆槽零召回；另外测原历史仍在prompt的真实行为，明确告知差异。若要求全上下文遗忘，应设计来源历史出站过滤，不能只删向量 | 现有删除不能证明原历史被删除；该语义影响端到端遗忘门槛及迁移tombstone职责，不可默默假定 |
| Go+PG迁移何时提供稳定ID/分页/幂等ACK？ | CM-1–6和内存缓存/窗口渲染先推进；完整持久化outbox、跨端游标与分页缓存对齐迁移接口 | 避免在ST JSONL上投入一套很快被替换的同步存储协议 |

不再询问“是否恢复桌面拟人等待”：UX-23已有“不加拟人延迟”决定，CM-6按此校正；允许沉默、状态幂等与单次生成原则继续保留。

**答（Owner / 总调度 2026-11-06）**：
- 遗忘语义：采用建议，首版边界为长期记忆、派生画像与记忆槽零召回；原历史仍在近期上下文时如实提示，不改提示词组装。
- 被测模型保持现有主聊天与提取配置；评审模型从已配置且可定价的模型中选，中转按实际单价计价；每轮硬上限 ¥100。
- 指标目标先跑一次真实基线再锁定。
- Go+PG 接口按 ST 退出计划 SX-2 冻结后提供；CM-1–6 与内存缓存、窗口渲染先行。

**补充答（Owner 2026-11-07，chat-memory-cm）**：本次先不核价，真实评测以 token 用量报告；沿用 1,000,000 上下文与 393,216（384K）最大输出配置。当前模型没有配置价格，因此本次明确使用仅计 token 的授权模式，实际费用记为未知，不宣称已验证 ¥100 上限。CM-2 仍实现并验证有价格时的 CNY 预留与熔断；缺价拒绝在 CNY 模式发包，不能静默切换为 token 模式。


**最新答（Owner 2026-11-07，迭代规则取代此前费用约定）**：真实评测不设费用上限；每轮完整core140，正常完整轮token参考在开跑前冻结，超过两倍自动停止并报告。先修评审一致率≥90%、保存可复核分歧、补齐140/140、核对生产配置，再以两次相同配置基线测噪声。优先复用已有被测输出重评；独立同结构hold-out调参期间不查看，仅达标确认运行。质量门槛仍按§3.3，可回答总体≥85%、每类≥75%、纠正当前值≥95%、遗忘/隔离/复活泄漏0；以配对bootstrap和噪声判断提升，类别退步标红。每轮产逐题失败归因与召回/首字时延；首字退步>20%说明取舍。core与hold-out达标，或连续5个改进轮无超噪声提升时停止汇报。CM-11保留文档且暂缓实施决定；CM-12/13在召回达标或停滞后再纳入。具体分支与V292评测边界见Backlog N节。

## 7. 本文验证边界

证据来自指定设计/测试报告、当前代码与测试源码，以及2026-11-06查阅的上述两篇基准论文和provider公开价格。未访问运行中应用、数据库或私有结果目录，未执行已有真实评测脚本；没有新增实测分数。文档交付检查仅限文件范围、引用/行号及 `git diff --check`，不启动无关测试。
