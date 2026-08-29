# ADR-0001：采用 V0.3.1 技术与传输基线

- 状态：Accepted（Go 目标 runtime、Fetch-SSE 恢复协议由 ADR-0007 在 Go cutover 时替代；当前 Java 行为在 cutover 前仍按本 ADR）
- 日期：2026-07-29
- 决策范围：Technical Alpha

## 背景

V0.3 产品方案中的旧技术描述与 V0.3.1 机器真源存在差异。V0.3.1 已将 Java、Spring 和 Alpha 传输方式写入 `.harness/tools.lock.yaml` 与 `specs/catalog/product-scope.yaml`，继续沿用旧描述会造成构建和协议双真源。

## 决策

1. Java 使用 25 LTS；Spring Boot 使用 4.1.x，当前精确版本 4.1.0。
2. Spring AI 使用 2.0.x，Spring Modulith 使用 2.1.x；当前精确版本分别为 2.0.0 和 2.1.0。
3. Alpha 对客户端使用 HTTP + Fetch-SSE；WebSocket 保持关闭。
4. 稳定标识统一使用 `generationId`，事件名和状态码必须来自 Catalog。
5. TASK-0001 只建立编译和运行骨架，不提前实现 Generation、SSE 或模型调用。

## 结果

- V0.3.1 机器真源正式覆盖 V0.3 中与上述内容冲突的技术叙述。
- 后续若降级到 Java 21、改用 WebSocket、变更 Spring Major 或更换协议，必须提交独立 ADR，并同步合法修改受保护真源。
- 选择 Fetch-SSE 不代表只实现“在线推送”；后续纵切仍必须落实 Gap、Reset、Snapshot 和持久化事件恢复契约。
