# 仓库结构与边界

```text
virtual-companion/
├── .harness/                  技术治理、真源边界和不变量
├── .github/workflows/         GitHub CI
├── specs/
│   ├── catalog/               Catalog 唯一机器真源
│   ├── contracts/             Generation、事务、实时等技术契约
│   └── generated/             确定性生成物，禁止手改
├── service/
│   ├── platform/catalog/      生成 Java Catalog 的编译模块
│   └── apps/runtime/          当前唯一可启动后端
├── frontend/                  uni-app H5
├── scripts/dev/               Windows/WSL 开发辅助脚本
└── docs/
    ├── source/                原始产品与架构方案快照
    ├── decisions/             ADR
    ├── engineering/           可执行开发说明
    ├── tasks/                 READY 任务与 Context Lock
    ├── evidence/              机器检查证据
    └── handoffs/              会话交接
```

## 后续模块落位

首个业务纵切应在新的 READY 任务中增加业务模块和适配器，建议边界为：

```text
service/
├── modules/
│   ├── conversation/
│   ├── safety/
│   ├── modelruntime/
│   └── memory/
├── adapters/
│   ├── model-fake/
│   ├── model-failure/
│   ├── persistence-postgres/
│   └── realtime-postgres-sse/
└── apps/
    ├── api/
    └── worker/
```

目录名只是建议，不授权 TASK-0001 创建业务代码。真正落位前必须先冻结 Generation、事务最终化、Worker Lease/Fence/RLS、授权快照和 Fetch-SSE 恢复契约，并补充相应测试与数据库约束。

## 依赖方向

```text
apps -> modules -> platform/catalog
apps -> adapters -> modules ports
adapters -> platform/catalog
```

模块不得依赖具体模型供应商或 HTTP SDK；协议适配器不得成为状态真源；Runtime 不得绕过业务端口直接写数据库。
