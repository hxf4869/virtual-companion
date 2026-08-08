# TASK-0107 独立复核 R1（只读）

- Reviewer: R1（independent review，C3）
- 候选提交: `5d054d55874d20b040652df17877ea676adbf34d`（tree `f661551da3933620a4cace7f37a1067d78448cc5`，已核对一致；单父提交，parent `457e5e2`）
- Base: `5a0490cca34230fae7b575814c7c18d84a7da9e0`
- 复核范围: COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK
- 方法: 静态审阅 `git diff 5a0490c..5d054d5` 与候选文件全文；未重跑 Maven（按要求），编译破坏性结论为静态可证

## 总体裁决: FAIL

发现 1 个阻塞性 P1：`ModelProtocolEventFence` 静态签名被移除，直接破坏 forbiddenPath 模块
`service/tests/model-protocol-contract-tests` 的测试编译，根级 canonical `mvnw verify`（验收 7）
在该候选树上必然 BUILD FAILURE；任务卡 API 契约明确要求"保持静态签名兼容"，且声称的
BUILD SUCCESS 无法在该树上复现（INV-HARNESS-005 风险）。其余发现均为非阻塞。

## 复核结论摘要（正面核验）

- **范围合规**：base→candidate 全部变更仅 11 文件（8 个实现文件 + task card + context lock + `.harness/project-state.yaml`），全部落在 writeAllowlist；forbiddenPaths（specs/**、**/db/migration/**、safety/memory、contract|authorization|registry|routing|port、model-openai、model-protocol-contract-tests/** 等）零触碰。AnthropicMessagesBoundaryContractTest.java 未改动（read-only）。
- **`git diff --check`**：干净（DIFF_CHECK_CLEAN）。
- **P2-01（实现正确）**：`ModelProtocolEventFence` 状态机完整——binding 完整相等（`ModelProtocolEventFence.java:47-48`）、sequence 从 0 严格连续（:50-54）、UsageReported 至多一次（:57-60）、AttemptEos 前必须已有 OutputDelta（:62-65）、terminal 后事件拒绝（:44-45）。`LiveModelInvoker` 事件循环应用 fence（`LiveModelInvoker.java:168,176-184`），违规走 `fenceViolationOutcome`（:231-243）：`RecoveryScenario.ALL_FAILURE` 额度释放 + `NON_RETRYABLE_FAILED` audit + `AdapterFailure.MalformedResponse` + `LiveAttemptTerminal.FAILED`；builder 局部内容随失败返回被丢弃，绝无部分输出/usage 污染。测试真实覆盖错 binding（断言响应不含 "leak"）、乱序、重复 usage、EOS 无内容（`LiveModelInvokerTest.java:95-176`），fence 单测覆盖乱序/跳跃/重复/terminal 后事件（`ModelProtocolEventFenceTest.java` 全部新用例）。既有测试脚本序列 0..3 连续，fence 不误伤合法流（`Scripts.success`）。
- **P2-02（实现正确）**：`decodeMessage` 遍历 content blocks，text 按序累积、tool_use 取 input JSON（`AnthropicMessagesCodec.java:86-124`）；`decodeStreamEvent` 新增 content_block_start/input_json_delta（partial_json）/content_block_stop（:146-185）。Session 结构化模式只接受 tool_use block + input_json_delta（text block/text_delta 拒绝），非结构化只接受 text block（`AnthropicMessagesSession.java:318-367`），message_stop 前 block 必须已结算且结构化须 blockSettled（:381-401）；结构化输出经 tool_use input 提取并 `requireStructuredJson` 验证（:277-281, 394-401）。测试用真实 tool_use/input_json_delta mock（`AnthropicContractTestSupport.java:204-284`），`structured_output_when_claimed` 非流+流双路径通过并断言请求侧工具名 `companion_response` 与 input_schema（`AnthropicMessagesSuccessContractTest.java:302-349`）；`nonStreamingToolUseWithoutStructuredModeFailsClosed` 覆盖验收 5 非流路径（:352-374）。
- **条件风险 5 / INV-GEN-003**：EOS 无内容 → CHAT_FAILED + ZERO_LLM fallback 被测试固定（`LiveModelInvokerTest.java:158-176`）；`LiveAttemptOutcome` 与 `FinalizeGenerationService` 均未改动，chat.completed 持久化仍由 FINAL_REVIEW 事务负责（`FinalizeGenerationServiceTest` 保持，覆盖 FINAL_REVIEW 前置条件）。
- **INV-AUTH-001**：授权决策流程未改动；fence 逐事件完整 binding 校验反而强化执行快照一致性。
- **ADJACENT_RISK（除 P1-01 外）**：model-openai、model-fake、model-failure、generation-contract-tests、runtime app 均不引用 fence 旧 API；AnthropicMessagesBoundaryContractTest 未改动且与新版 session 行为兼容（其 streaming 用例均含 content_block_start/stop）。唯一破坏即 P1-01。

## Findings

### P0（阻塞性安全/不变量破坏）

无。

### P1（验收违反，阻塞）

- **P1-01 — `ModelProtocolEventFence` 静态 API 被删除，破坏 forbiddenPath 模块编译，根级 verify 必然失败（验收 7 违反 + 卡 API 契约违反 + ADJACENT_RISK）**
  - 任务卡 `/docs/tasks/TASK-0107-model-protocol-correctness.md:246` 明确："`ModelProtocolEventFence.accept(expected, candidate)`：**保持静态签名兼容**；有状态校验由新增的 fence 状态承载"。
  - Base 版本为 `public static Optional<ModelProtocolEvent> accept(InvocationBinding, ModelProtocolEvent)`；候选改为实例方法 `accept(ModelProtocolEvent)` + `FenceViolation`（`ModelProtocolEventFence.java:42`），静态 2 参方法被整体移除。
  - 未修改的 forbiddenPath 测试仍调用旧静态 API：`service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/FailureModelProtocolAdapterContractTest.java:148,174,176`（`ModelProtocolEventFence.accept(expected, late)` / `accept(mismatch, event)`）。
  - `service/tests/model-protocol-contract-tests` 在根 reactor（`pom.xml` modules 列表），模块 pom 与父 pom 均无 test-compile/skip 配置 → 该模块 test-compile 必然报 "cannot find symbol"，canonical 命令（卡 :209）与验收 7（卡 :278）"根级 Maven verify BUILD SUCCESS" 在该候选树**不可达成**。
  - 因此声称的"BUILD SUCCESS（根级 verify）"无法在本树复现：若为事实，则执行的不是冻结的 requiredCommand（如 `-pl` 子集），不得记为 PASS（INV-HARNESS-005 风险：evidence 不得把未执行/失败的检查转成 PASS）。
  - 修复约束：只能改 writeAllowlist 内文件（如在 fence 内保留静态兼容 overload/委托，保持旧语义 Optional 丢弃或映射 FenceViolation），不得直接改 forbiddenPath 的 contract test；若确需改 contract test 文件，按卡"停止条件"先停止并询问 Owner。

### P2（非阻塞缺陷）

- **P2-01 — 验收 3"混合 text+tool_use blocks 按序累积文本"未按字面实现，且无多 text block 累积测试**
  - `AnthropicMessagesCodec.java:97-103`：先 text 后 tool_use 的混合 block 直接抛 `AnthropicCodecException`（注释 "Mixed text and tool_use blocks have no single consumer; fail closed instead of guessing"），多 tool_use 同样拒绝（:105-110）。该 fail-closed 选择与卡"任何协议不符→失败关闭"精神一致、更保守，但与验收 3 文本字面冲突；同时"多 text block 按序累积"（:103 循环累积已实现）没有任何测试覆盖。建议在 Handoff 记录偏离说明或补充澄清/测试。

- **P2-02 — 流式负路径无测试证据（验收 5 的流式半路径 + 结构化模式 text_delta 拒绝）**
  - 代码路径存在且正确：非结构化流式收到 tool_use block/input_json_delta 拒绝（`AnthropicMessagesSession.java:322-326, 356-362`），结构化模式 text block/text_delta 拒绝（:322-326, 350-352）；但均无测试。验收 5 仅有非流测试（`AnthropicMessagesSuccessContractTest.java:352-374`），结构化负路径（text_delta in structured）亦无测试。

### P3（建议）

- **P3-01 — 响应 tool_use name/schema 与请求声明的运行时一致性未校验**：Session 结构化路径只取 input（`AnthropicMessagesSession.java:277-281, 394-401`），不校验返回的 tool_use `name` 是否等于请求声明的工具名；测试中 mock 与请求同名（`AnthropicContractTestSupport.java:218` vs `:342-346`）属构造性一致，非断言。建议在 session 增加 name 一致性校验（契合"验证 tool name/schema 与请求一致"）。
- **P3-02 — `ContentBlockStop` 的 `index` 未被交叉校验**：codec 解析 index（`AnthropicMessagesCodec.java:170-172`）但 session 忽略，`content_block_stop` 可与 `content_block_start` 的 index 不一致仍被接受。
- **P3-03 — 验收 6 的 EOS→FINAL_REVIEW 契约证据为"保持"**：`FinalizeGenerationServiceTest`（persistence）未在本卡改动，属卡内"增加/保持"的"保持"分支，可接受；建议 Handoff 明确引用该测试位置。

## 不变量核验

- INV-AUTH-001：PASS（授权流程未改，fence 增强逐事件 binding 相等）。
- INV-GEN-003：PASS（EOS 无内容 → CHAT_FAILED 测试固定；LiveAttemptOutcome/FinalizeGenerationService 未改）。
- INV-HARNESS-005：**PASS 条件不成立**——本卡声称的根级 verify BUILD SUCCESS 无法在候选树复现（见 P1-01），closure 时证据不得将该命令记为 PASS。
- INV-HARNESS-002/003/007/009：无违反（范围、单父原子提交、保护路径合规）。

## 复核结论

裁决 FAIL（1 个阻塞 P1）。修复建议：在 `ModelProtocolEventFence`（writeAllowlist 内）保留静态签名兼容的
`accept(InvocationBinding, ModelProtocolEvent)` 兼容入口（或将旧调用映射到新语义），使
`FailureModelProtocolAdapterContractTest` 恢复编译后重跑根级 verify；如需触碰 forbiddenPath 的
contract test 文件，须先停止并询问 Owner。修复后 R2 复核。
