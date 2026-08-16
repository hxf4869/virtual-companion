# TODO

产品待办（现状声明见 README）：

- [ ] 接通 Generation 完整 HTTP 纵切（controller ↔ 领域内核 ↔ provider adapters）
- [ ] 接通 Realtime/Message 纵切与 SSE 流式链路
- [ ] 接通 Memory 纵切（含 snapshot 接口）
- [ ] 实现 OpenAPI 已定义但尚无 controller 的合同面：version、relationship、message、snapshot 等
- [ ] production profile 对显式 `false` 的 Auth/datasource 开关改为启动失败强制（当前仅文档要求）

> 注：旧 backlog 中 13 张未交付规划卡（TASK-0039~0041、0043~0047、0049~0053）均为旧治理体系自身的
> 提速任务，随治理机制于 2026-08-16 退役而全部作废；历史规划见 `docs/archive/task-backlog.yaml`。
