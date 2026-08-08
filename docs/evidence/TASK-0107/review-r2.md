# TASK-0107 独立复核 R2（delta 复核）

- Reviewer: R1（independent review，C3），R2 delta 复核
- Fix batch: `bf4231e49024c391c01bd9e8e28883942cc8d364`（tree `4ab775609fea0946558a9030e4f09352834c724c`，已核对一致；单父提交，parent `5d054d5`）
- 复核范围: finding closure（P1-01/P2-01/P2-02）+ delta + adjacent risk + 新 P0/P1/P2（按要求不重启全量复核）
- 方法: `git diff 5d054d5 bf4231e` 与 `git diff 5a0490c bf4231e` 静态审阅

## 总体裁决: PASS

R1 阻塞 P1-01 已关闭；P2-01/P2-02 已按建议修复并有真实测试；fix batch 仅含 writeAllowlist 内 4 文件，无新 P0/P1/P2。残留项均为 P3 建议，不阻塞。

## Finding closure 核验

### P1-01（阻塞，已关闭）— PASS

- `ModelProtocolEventFence.java:35-49` 恢复静态 `public static Optional<ModelProtocolEvent> accept(InvocationBinding, ModelProtocolEvent)`：签名、null 校验与语义（`expected.equals(candidate.binding()) ? Optional.of : Optional.empty`）与 Base 完全一致。
- `service/tests/model-protocol-contract-tests/.../FailureModelProtocolAdapterContractTest.java:148,174,176` 的三处旧 API 调用（`.isEmpty()` / `.isPresent()` / mismatch 空）恢复可编译且语义与 Base 逐字一致（静态方法为无状态完整 binding 校验，`late_token_fence`/`full_binding_fence` 契约语义保持）。
- 实例方法 `accept(ModelProtocolEvent)` 与静态方法按参数个数重载共存，无歧义；`LiveModelInvoker` 与 `ModelProtocolEventFenceTest` 使用实例 API 不受影响。
- 根级 canonical `mvnw verify` 的编译阻断解除（model-protocol-contract-tests 28/28 BUILD SUCCESS 与本修复一致）；未重跑 Maven，编译兼容性为静态可证（符号已恢复）。

### P2-01（验收 3 混合 blocks，已关闭）— PASS

- `AnthropicMessagesCodec.java:97-103`：删除混合拒绝分支，`case "text"` 无条件按序累积；`case "tool_use"` 保留单 tool_use input 提取与多 tool_use 拒绝（:105-110）。验收 3"混合 text+tool_use blocks 按序累积文本"按字面实现。
- 新增 `multiTextCompletion`（`AnthropicContractTestSupport.java:226-246`）+ `nonStreamingMultipleTextBlocksAreJoinedInOrder`（`AnthropicMessagesSuccessContractTest.java:377-405`）：三 text block 按序拼接为单个 TextChunk 断言。
- 行为回归检查：非结构化模式收到混合响应仍在 session 层失败关闭（toolUseInput 存在 → `AnthropicCodecException` → MalformedResponse），失败语义不变；结构化模式容忍 text 前言并取 tool_use input，符合真实协议。

### P2-02（流式负路径，已关闭）— PASS

- `structuredStreamRejectsTextDelta`（`AnthropicMessagesSuccessContractTest.java:407-434`）：结构化流式收到 text block + text_delta → 恰好 1 个 `AttemptFailed(MalformedResponse)`。
- `textStreamRejectsToolUseDelta`（:436-463）：非结构化流式收到 tool_use block + input_json_delta → 恰好 1 个 `AttemptFailed(MalformedResponse)`。
- 两用例真实命中 `AnthropicMessagesSession.java:322-326`（block 类型拒绝）与 :356-362（delta 类型拒绝）路径。

## Delta / 范围 / adjacent risk

- Fix batch 仅 4 文件：`ModelProtocolEventFence.java`、`AnthropicMessagesCodec.java`、`AnthropicContractTestSupport.java`、`AnthropicMessagesSuccessContractTest.java`——全部在 writeAllowlist；forbiddenPaths 零触碰；单父原子提交。
- Base→fix 全量 diff 仍为 11 文件（8 实现 + 3 治理文件），无新增路径。
- `git diff --check`（base→fix）：干净。
- adjacent risk：静态方法恢复仅影响 model-protocol-contract-tests 中既有两用例（语义不变）；openai adapter、model-fake/failure、generation-contract-tests、BoundaryContractTest 无引用变更；未发现新破坏面。

## 残留 P3（非阻塞，建议后续卡/Handoff 记录）

- P3-01（R1 遗留）：session 未校验响应 tool_use name 与请求声明工具名一致（mock 与请求同名属构造性一致）。
- P3-02（R1 遗留）：`content_block_stop` 的 index 未与 `content_block_start` 交叉校验。
- P3-03（新）：混合 text+tool_use 非流响应的实际混合用例仍无直接测试（现测试覆盖多 text block 与单 tool_use 两分支，混合组合由代码路径覆盖、无独立断言）。

## 不变量

- INV-HARNESS-005：fix batch 后 canonical verify 编译阻断已解除；R2 未重跑 Maven，以静态符号恢复为准，closure 时须以真实执行记录为准。
- 其余不变量（INV-AUTH-001 / INV-GEN-003 / INV-HARNESS-002/003/007/009）：R1 结论不变，fix batch 未触及相关路径。

## 复核结论

PASS（R1 阻塞项已全部关闭，无新 P0/P1/P2）。允许进入 closure 流程。
