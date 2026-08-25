# DOGFOOD-06 影子 Embedding 评测记录（ADR-0006 §6.2）

- 日期：2026-08-24；执行：Agent（本地 OrbStack Docker + 本机 Ollama）。
- 基线：Git `90e85358` + 当前未提交工作树；不是可发布的不可变制品。
- 结论级别：**结构评测完成，不设通过阈值、不外发质量结论**（ADR §6：本轮影子
  评测不改变默认召回、不写入现行向量空间、不迁移数据库）。

## 评测方法

| 项目 | 值 |
|---|---|
| 测试入口 | `service/apps/runtime/src/test/java/com/virtualcompanion/runtime/memory/ShadowEmbeddingEvalTest.java` |
| 门禁 | `@EnabledIfEnvironmentVariable(VC_SHADOW_EVAL=1)`——默认 CI 自动跳过（验证：无 env 运行 `Tests run: 1, Skipped: 1`） |
| 对比对象 | `DeterministicEmbedder`（alpha-hash-64，现行默认）vs 本机 Ollama `qwen3-embedding:0.6b`（上游 `Qwen/Qwen3-Embedding-0.6B`）经 `OpenAiCompatEmbedder` OpenAI 兼容层调用 |
| Ollama 端点 | `http://localhost:11434/v1`（env `VC_SHADOW_EVAL_OLLAMA_BASE` 可覆盖），api key 占位 `ollama` |
| 样本 | 全部合成内联中文样本（句式风格参照 `scripts/measure/gen_mem_eval_samples.py`），无真实人名/联系方式/敏感内容 |
| 计算方式 | 纯内存余弦（L2 归一化后 dot/(‖a‖·‖b‖)）；不调用 `upsertEmbedding`/`semantic_recall`/任何 DB 路径 |
| 断言 | 仅"评测已执行且指标可计算"（语料结构下限、维度一致、指标 ∈ [0,1]），无质量阈值 |

### 样本构成（事实库共 44 条）

- a) 同义改写组 **24 对**：第一人称事实语句 + 查询改写，覆盖同义换词（攒钱→存钱）、
  语序变化（"我最喜欢的乐队是X"→"X是我最喜欢的乐队"）、口语化（十五分钟→一刻钟）。
- b) 干扰组 **12 条**：与 a 组同域不同事实（辣火锅 vs 清蒸鱼、柯基 vs 橘猫等），
  进入事实库参与 top-k 竞争。
- c) 无匹配查询 **8 条**：明确库外话题（量子纠错、足球赛果、股市、烘焙、摄影、
  海水鱼缸、二手车过户、冬奥举办地）。
- d) 跨关系组：2 个"关系"各 **4 条**同域专属事实（日料/意面、晨跑/晚起、白猫/黑猫、
  爬山/宅家）+ **6 条**指向单一关系的查询（3 指 A、3 指 B）。

### 指标定义

- 同义改写 Recall@3：查询向量在全部 44 条事实（a+b+d）中余弦 top3 含正确事实的比例。
- 误召回率：无匹配查询 top1 相似度 ≥ 阈值的比例（阈值 0.60/0.70/0.80 三档敏感性）；
  无匹配拒绝率 = 1 − 误召回率。
- 跨关系污染：指向关系 A 的查询 top3 中命中关系 B 事实的槽位比例（6 查询 × 3 槽 = 18）。
- 跨关系相似度差：对每条关系查询取"本关系 4 条事实平均余弦 − 另一关系 4 条事实平均
  余弦"，再跨 6 条查询平均（正值表示本关系更近）。
- 参考行"relationship query Recall@3"：关系查询的正确事实进入 top3 的比例（上下文参考，
  非独立门槛）。

## 维度探测结论

1. `POST /v1/embeddings` 带 `dimensions=64` → 返回 **64 维**、L2 归一化（MRL 截断）。
   Ollama 原生输出 1024 维，但 64 维请求被正确处理——**无需 Modelfile 变体**，
   按 ADR §6.2 直接以 64 维评测。
2. 探测在测试内运行时自动执行（`VC_SHADOW_EVAL_OLLAMA_MODEL` 可注入备用模型名）；
   若某环境忽略 `dimensions`，测试回退原生维度并如实打印，本次未触发该路径。

## 指标对比（2026-08-24 实测，三次运行数值一致）

| 指标 | deterministic-hash-64 | qwen3-embedding:0.6b（64d） |
|---|---|---|
| 同义改写 Recall@3 | 0.750 | **1.000** |
| 误召回率@0.60 | **0.000** | 0.125 |
| 无匹配拒绝率@0.60 | **1.000** | 0.875 |
| 误召回率@0.70 / @0.80 | 0.000 / 0.000 | 0.000 / 0.000 |
| 无匹配拒绝率@0.70 / @0.80 | 1.000 / 1.000 | 1.000 / 1.000 |
| 跨关系污染（top3 槽位） | **0.056**（1/18） | 0.167（3/18） |
| 跨关系相似度差（本−他） | +0.042 | +0.038 |
| 关系查询 Recall@3（参考） | 0.333 | 1.000 |

无匹配查询 top1 相似度明细：deterministic `[0.500,0.539,0.375,0.456,0.522,0.408,
0.522,0.357]`；qwen `[0.472,0.523,0.537,0.598,0.468,0.509,0.528,0.636]`（唯一越过
0.60 的是"下届冬奥会举办地"，与库内"周末爬山/看纪录片"等休闲语句语义相邻）。

**观察（非结论）**：qwen 在同义改写与关系查询上召回显著更高；代价是无匹配查询的
top1 相似度整体抬高（0.47–0.64 vs 0.36–0.54），且 top3 更容易被另一关系的同域事实
占据——语义 embedding 分不开"白猫雪球/黑猫墨墨"这类平行事实，关系隔离不能依赖
向量，需继续依赖 SQL/RLS 关系作用域（`infra/db/measure/phases/81_cross_relationship_
recall.sql` 已有 SQL 层覆盖）。若未来引入阈值拒绝，qwen 的操作点需重新标定，
不能沿用确定性 embedder 的相似度分布。

## 结构性声明

- 未切换默认 `EmbeddingPort`；未注册任何 Spring bean；未新增依赖（复用
  `OpenAiCompatEmbedder` 现有 HTTP 客户端）。
- 未写入现行向量空间：评测全程纯内存，不调用任何持久化路径；两个空间互不写入。
- 未迁移数据库、未引入 Mem0/Letta/Graphiti。
- 删除防复活在本影子评测结构上不可达（不落库），由既有 SQL 测试覆盖：
  `infra/db/measure/phases/80_mem_delete_resurrection.sql`。
- Ollama 容器（`shadow-eval-dogfood06`）与模型仅本地，未访问 HuggingFace 或云
  embedding 服务；评测结束容器已销毁。

## 执行证据

- `VC_SHADOW_EVAL=1 JAVA_HOME=/opt/homebrew/opt/openjdk@25 ./mvnw --batch-mode
  --no-transfer-progress -pl service/apps/runtime -am test
  -Dtest=ShadowEmbeddingEvalTest` → `Tests run: 1, Failures: 0, Errors: 0,
  Skipped: 0`，BUILD SUCCESS；surefire 报告
  `service/apps/runtime/target/surefire-reports/`（txt+xml），测试内打印完整对比表。
  注：需 `-am`，本地仓库无兄弟模块快照；评测期间并行批次的 runtime 主源码/测试一度
  处于不可编译中间态，最终运行在其自洽后完成。
- 无 env 回归验证：`-Dtest='ShadowEmbeddingEvalTest,DeterministicEmbedderTest'` →
  ShadowEmbeddingEvalTest `Skipped: 1`（CI 安全），DeterministicEmbedderTest 6/6 通过。

## 局限

- **合成样本不代表真实语义质量**（ADR §6.1）：样本量小（44 事实/38 查询）、句式由
  Agent 构造，天然偏向语义模型的改写模式；结果只能说明两种 embedder 在该合成分布上
  的相对行为，不能外推真实对话召回率。
- qwen3-embedding 未加官方 instruct/query 前缀（Ollama 兼容层不注入），上游检索精度
  可能被低估；同时 64 维 MRL 截断相对原生 1024 维有信息损失，本评测未对比。
- 单次静态语料、单模型版本、单机 CPU 推理；无延迟/成本维度。
- ADR §6.3 约束不变：本轮不据此切换默认 embedding 或建新空间；只有 Owner 明确收益
  判断后才另行决策（含受控 re-embed）。

## Owner 待办

- 如需更接近真实的判据：由 Owner 提供脱敏改写样本（参考
  `scripts/measure/gen_mem_eval_samples.py` 产出的 workset 流程）补充评测；本任务
  未使用任何 Owner 脱敏样本（全部合成）。
- 若考虑引入 qwen 路径，需先定：阈值操作点重标定、关系隔离继续由 SQL 作用域承担、
  以及 64d vs 原生维度的取舍对比。
