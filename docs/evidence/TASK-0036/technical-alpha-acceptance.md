# TASK-0036 — Technical Alpha 总验收矩阵（technical-alpha-acceptance.md）

- **任务**：TASK-0036（Technical Alpha 隔离、安全、记忆、故障与指标总验收），criticalPath 终点
- **baseCommit**：`b515364208a8f3b6e204d9025eddc053118ad14a`
- **candidateCommit**：（候选提交，由 `evidence-pack.json` headCommit 绑定，终态填写）
- **authorizationCommit**：`0f853e6eea08569f1d1e3eef1fef2d948e213c23`（READMEY，READY doctor PASS 378055 checks）
- **验证通道**：`LOCAL_EXACT_TREE_FALLBACK`，profile `precheck`（READMEY 冻结；remote PRIMARY_REMOTE_EXACT_SHA 以强类型 QUOTA 证据不可用）
- **结论**：AC1–AC5 全部真实通过；Technical Alpha 禁止能力保持关闭；P0/P1 为零、P2 全部闭环或显式非阻塞处置。

---

## 1. AC1 — 依赖终态 Evidence 可追溯

5 张依赖卡全部 ACCEPTED 且推送；其 Evidence Pack、独立 Review、Handoff 均存在且 headCommit 在 Git 历史中可复算。

| 依赖卡 | evidence-pack headCommit | review 文件 | review 结论 | handoff headCommit | 在历史 |
|---|---|---|---|---|---|
| TASK-0026 | `21eab7e86aee…` | review-r1.md | PASS（0 P0/P1，2 P2 非阻塞 deferral） | `21eab7e86aee…` | ✅ |
| TASK-0030 | `106cecbabdd5…` | review-r1.md | PASS（0 P0/P1/P2，5 P3 非阻塞） | `106cecbabdd5…` | ✅ |
| TASK-0032 | `828241e13f74…` | review-r1.md + review-r2.md | R1 PASS（2 P2）+ R2 finding-closure PASS | `828241e13f74…` | ✅ |
| TASK-0034 | `280c002f91cc…` | review-r1.md + review-harness-fixes-r1.md | PASS（0 P0/P1/P2，6 P3 非阻塞） | `280c002f91cc…` | ✅ |
| TASK-0035 | `66dc2576861e…` | review-r1.md + review-r2.md | R1 PASS（3 P2）+ R2 finding-closure PASS | `66dc2576861e…` | ✅ |

**如实处置（非掩盖）**：
- TASK-0034 evidence-pack 含 1 条历史 `FAIL`（`python -m unittest discover -s scripts/harness/tests`，239 run / 1 failure `test_backlog_draft_reconstructs_base_git_snapshot`）。该失败为 **pre-existing harness 测试保真问题**（Gate 批准 e126c12 引入审批数据后 fixture 未同步），已证明在 TASK-0034 之前的 `15cdee8` 同样失败、非本卡引入；随后由 Owner 授权 harness-change post-closure 修复 `ef3891c`（pin 重建 TASK-0034 DRAFT 卡）。本矩阵在 HEAD 重新执行 harness unittest 确认转绿（见 §2）。
- TASK-0034 handoff `nextAction` 指向 TASK-0035 READY；TASK-0035 后 project-state `nextAction` 已推进至 TASK-0036（本卡），与 Backlog 顺序一致。

## 2. AC2 — 总验收矩阵（8 域，真实执行）

全部命令在候选树干净工作树/干净 index 上以冻结 argv 执行；每项记录真实退出码与结果。

### 2.1 跨租户隔离（INV-TENANT-001）
`wsl.exe … bash infra/db/run-rls-tests.sh` → **PASS，39/39**。覆盖：跨用户读拒（01）、跨关系引用拒（02）、跨会话引用拒（03）、authorization snapshot 隔离（06）、跨 owner generation 引用拒（15）、realtime_event RLS owner 隔离（25）、记忆跨租户 fail-closed（33）。

### 2.2 授权撤销（INV-AUTH-001 相邻）
RLS 身份/撤销矩阵：worker 凭据/lease/fence（04/05/07–11）、coordinator 仅元数据（12）、identity accounts/sessions（39）；Spring Security JWT 由 runtime 85 测试覆盖（未认证→AUTHENTICATION_REQUIRED、DISABLED token fail-closed、refresh 服务端有状态撤销）；TASK-0035 R2 关闭 P2#2 授权快照 provider 交叉校验。

### 2.3 安全失败（safety-fail-closed）
Safety 模块 13 tests（SafetyGate/SafetyReview/DeterministicSafetyResponse）；RLS 故障注入（17 fault injection rollback）、provider EOS 不完成（18，INV-GEN-003）；TASK-0035 SafetyGate adequate 才外发。

### 2.4 记忆删除与生命周期（INV-MEM-001/002）
RLS 记忆矩阵 7 项全 PASS：确认路径唯一（32）、跨隔离（33）、生命周期证据作用域（34）、编辑证据（35）、幂等（36）、召回作用域预算（37）、tombstone 确定性（38）；canonical 记忆仅 ACCEPTED、模型输出仅产生候选（TASK-0027/0028/0030）。

### 2.5 故障恢复（INV-GEN-003/INV-TX-001）
RLS 原子终态（16 atomic finalize）、故障注入回滚（17）、幂等接收（13/14）、cancel（30）、消息历史分页（31）；GenerationRecovery 由 modelruntime 104 tests 覆盖（TIMEOUT/CANCELLED/ALL_FAILURE 释放配额、NO_CAPACITY fail-closed、ZERO_LLM 不伪造 provider_attempt）。

### 2.6 协议（realtime/model-protocol）
RLS realtime 矩阵 7 项（19–25）：ticket 单次使用 TTL、连续游标恢复、gap 过期窗、epoch reset、终态快照、not-found/forbidden、RLS 隔离；OpenAI/Anthropic 离线协议契约测试随 Maven 全绿；openapi validate + diff PASS。

### 2.7 指标、审计（provider_attempt/usage/realtime_event）
TASK-0035 审计链（ProviderAttemptAudit 无凭据/内容 + TokenUsage + realtimeEventType 映射）由 LiveModelInvokerTest 15 tests 覆盖；RLS 12 coord、19 realtime ticket 审计路径 PASS。

### 2.8 性能基线与发布证据
- **Maven 全模块**：`mvn -o -pl service/apps/runtime -am test` → **BUILD SUCCESS，243 tests / 0 failures / 0 errors**（catalog 2 + safety 13 + modelruntime 104 + persistence 39 + runtime 85）。
- **frontend**：vitest **93 passed（11 files）**；vue-tsc `--noEmit` **PASS**。
- **harness unittest**：239 tests **全绿**（本矩阵 HEAD 重新执行）。
- **openapi**：validate **PASS** + diff `--fail-on-drift` **PASS**。
- **precheck**（canonical）：`python scripts/harness/precheck.py --task TASK-0036` → **PASS**（doctor+catalogValidate+catalogDrift+paidFeatureCheck+betaRosterGate）。
- **运行期基线端点**：`/api/internal/baseline` 断言 phase=TECHNICAL_ALPHA、transport=HTTP_SSE、technology=25-LTS、受限能力全 false（BaselineControllerTest）。
- 如实声明：应用层独立性能 benchmark（吞吐/延迟基准脚本）在仓库中不存在，本矩阵不编造性能数据；性能基线以真实执行的测试规模（243 Maven + 39 RLS + 93 vitest + 239 harness）与运行期基线断言代替，作为 Technical Alpha 发布证据。

## 3. AC3 — Alpha 禁止能力保持关闭

| 检查点 | 真源/命令 | 结果 |
|---|---|---|
| 真实支付 | `.harness/project-state.yaml` capabilityGates.realPayment | **FORBIDDEN**（Technical Alpha 明确禁止） |
| 真实用户 Beta | capabilityGates.realUserBeta | **BLOCKED**（PIA/伦理/成年验证/责任人/值班/演练未全证据） |
| 业务实现 | capabilityGates.businessImplementation | **BLOCKED** |
| 付费前置 | `scripts/harness/check_paid_features.py` | **PASS**（23 文件，无付费运行时依赖；denylist 5 规则） |
| Beta 值班门禁 | `scripts/harness/check_beta_gate.py` + `ops/beta-duty-roster.yaml` | **CLOSED**（generation 保持关闭） |
| 产品能力开关 | `specs/catalog/product-scope.yaml` | publicRegistrationEnabled=false、paymentEnabled=false、romanceModeEnabled=false、voiceEnabled=false、imageEnabled=false、websocketEnabled=false、betaGenerationEnabledByDefault=false、zeroLlmDefaultForFree=false |
| 运行期强制 | `service/apps/runtime/…/TechnicalAlphaCapabilities.java` + BaselineControllerTest | 7 项受限能力任一开启即构造失败（IllegalStateException）；基线端点断言全 false |
| 目录快照 | catalogValidate + catalogDrift（precheck 内） | PASS（无漂移） |

## 4. AC4 — P0/P1/P2 闭环处置表

5 张依赖卡 R1/R2 全部 PASS：**P0 = 0，P1 = 0**。全部 P2 已闭环（CLOSED）或显式非阻塞处置（附 review 证据）。

| 卡 | 发现 | 严重级 | 处置 | 证据 |
|---|---|---|---|---|
| TASK-0026 | P2-1 chat.vue resume 未走单次 ticket 流；P2-2 readSseEvents 丢弃 nextEpoch | P2 | **非阻塞处置**：R1 判定 confined to 未测 .vue 运输胶水、生产互操作、不崩溃/不披露存在；backend-integration 后续任务接线（handoff remaining 已记录） | review-r1.md |
| TASK-0030 | 0 P0/P1/P2；5 条 P3 | — | 5 P3 非阻塞 deferral（handoff knownRisks） | review-r1.md |
| TASK-0032 | F1 NO_CAPACITY 预留泄漏；F2 release 无上限 | P2 | **CLOSED**：R2 fix batch（NO_CAPACITY 非空预留 fail-closed throw + release 按 provisioned ceiling 封顶），新测试证明 | review-r2.md |
| TASK-0034 | 0 P0/P1/P2；6 条 P3（含 2 条闸门固有权衡、1 条 harness post-closure） | — | 6 P3 非阻塞处置 | review-r1.md + review-harness-fixes-r1.md |
| TASK-0035 | P2#1 externalAttemptCreated 误报；P2#2 授权快照未交叉校验；P2#3 blank hard-rule | P2 | **CLOSED**：R2 fix batch（audits 非空判定 + provider 绑定检查 BLOCKED_BY_AUTHORIZATION + 构造期拒 blank），各附新测试；P3#1/#2 按 knownRisk 关闭 | review-r2.md |

**闭环语义**：P0/P1 为零；P2 中 TASK-0032（2）与 TASK-0035（3）由 fix batch 实测关闭，TASK-0026（2）由 R1 独立复核明确判定为不崩溃、不披露存在的非阻塞 deferral 并记录后续任务——矩阵据实标注，不将 deferral 表述为已修复。无未处置 P2。

## 5. AC5 — 指标/审计/性能基线

- **审计链**：真实外发产出 ProviderAttemptAudit（provider_attempt）+ TokenUsage（usage）+ realtimeEventType()（realtime_event）；ProviderAttemptAudit 仅身份+结局+运行期配置供应商名，零凭据/内容；degraded 路径不伪造 CHAT_COMPLETED（INV-GEN-003）。
- **指标基线**：Maven 243 tests / 0 failures；RLS 39/39；vitest 93；harness 239；openapi validate+diff PASS；precheck PASS。
- **发布证据**：运行期基线端点 `/api/internal/baseline` 绑定 product-scope 快照（phase/transport/capabilities），受限能力构造期强制 false。
- **N/A 如实标注**：应用层吞吐/延迟 benchmark、QuotaLedger 真实持久化结算、provider_deployment 持久化同步、LiveModelInvoker 生产调用入口均不存在/属后续任务——矩阵不编造，全部记录于本卡 handoff knownRisks。

## 6. 结论

TASK-0036 总验收矩阵 **真实通过**：5 张依赖卡终态 Evidence 全部可追溯；8 域矩阵（跨租户/授权撤销/安全失败/记忆删除/故障恢复/协议/指标审计/性能基线）全部真实执行且全绿；Technical Alpha 禁止能力全部保持关闭；P0/P1 为零、P2 闭环或显式非阻塞处置；不存在的性能能力如实 N/A。Technical Alpha 达到其声明边界的可验收状态，未越过 Beta/公开注册/真实支付边界。
