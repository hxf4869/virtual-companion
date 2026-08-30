# 仓库结构与边界

```text
virtual-companion/
├── .github/workflows/         GitHub CI（backend / database / frontend / supply-chain / checks）
├── specs/
│   ├── catalog/               Catalog 唯一机器真源
│   ├── contracts/             Generation、事务、实时等技术契约
│   ├── openapi/               OpenAPI 合同面（手写唯一真源）
│   └── generated/             确定性生成物，禁止手改
├── service/
│   ├── platform/catalog/      生成 Java Catalog 的编译模块
│   └── apps/runtime/          当前唯一可启动后端（cutover 前）
├── backend/                   Go companiond（G2 起；G4 adapter；G5 companion/turn/safety 离线 core；cutover 前不接生产流量）
├── frontend/                  uni-app H5
├── scripts/
│   ├── checks/                秒级仓库检查（catalog/licenses/paid）及其数据文件
│   ├── check.sh               日常检查唯一入口
│   └── dev/                   Windows/WSL 开发辅助脚本
└── docs/
    ├── source/                原始产品与架构方案快照
    ├── decisions/             ADR
    ├── engineering/           技术基线等开发说明
    ├── superpowers/specs/     设计文档
    ├── architecture/          仓库边界与结构说明
    ├── tasks/                 旧治理任务卡档案（只读）
    ├── evidence/              旧治理证据档案（只读）
    ├── handoffs/              旧治理交接档案（只读）
    └── archive/               旧治理机器状态快照（只读）
```

## 后续模块落位

首个业务纵切应按此边界增加业务模块和适配器，建议边界为：

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

目录名只是建议。真正落位前必须先冻结 Generation、事务最终化、Worker Lease/Fence/RLS、授权快照和 Fetch-SSE 恢复契约，并补充相应测试与数据库约束。

## 依赖方向

```text
apps -> modules -> platform/catalog
apps -> adapters -> modules ports
adapters -> platform/catalog
```

模块不得依赖具体模型供应商或 HTTP SDK；协议适配器不得成为状态真源；Runtime 不得绕过业务端口直接写数据库。
