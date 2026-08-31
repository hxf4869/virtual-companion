# 仓库结构与边界

```text
virtual-companion/
├── .github/workflows/         GitHub CI（backend / database / frontend / supply-chain / checks）
├── specs/
│   ├── catalog/               Catalog 唯一机器真源
│   ├── contracts/             Generation、事务、实时等技术契约
│   ├── openapi/               OpenAPI 合同面（手写唯一真源）
│   └── generated/             确定性生成物，禁止手改
├── backend/
│   ├── cmd/companiond/        唯一后端进程与 migrate/bootstrap 子命令
│   └── internal/              HTTP、业务、任务、供应商、持久化与迁移实现
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

## 后端模块落位

后端模块按当前生产职责组织：

```text
backend/
├── cmd/companiond/            进程入口、migrate、bootstrap
├── internal/app/              生命周期与依赖装配
├── internal/httpapi/          opaque session API 与 SSE
├── internal/companion/        生成领域模型
├── internal/turn/             turn intake/finalize
├── internal/jobs/             worker、scheduler 与恢复
├── internal/provider/         三类模型协议适配
├── internal/realtime/         进程内实时分发
├── internal/store/postgres/   pgx、短事务与 RLS
└── internal/migrate/          嵌入式 SQL migrator 与 V1–V119
```

新增能力必须继续遵守 Generation、事务最终化、Worker Lease/Fence/RLS、授权快照和
Fetch-SSE 契约，并补充对应测试与数据库约束。

## 依赖方向

```text
cmd/companiond -> internal/app
internal/app -> httpapi + jobs + provider + store
httpapi/jobs -> companion + turn + store ports
store/postgres -> PostgreSQL/RLS
```

模块不得依赖具体模型供应商或 HTTP SDK；协议适配器不得成为状态真源；Runtime 不得绕过业务端口直接写数据库。
