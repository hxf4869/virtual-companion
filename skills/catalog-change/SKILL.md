---
name: catalog-change
description: 修改 specs/catalog 的状态码、枚举、产品范围或其他 Catalog 真源，并确定性再生 specs/generated 时使用。
metadata:
  id: catalog-change
  version: 1.0.0
  riskClass: C3
---

# Catalog Change

## Preconditions

- READY 任务明确列出 `catalog-change@1.0.0`，写入范围覆盖目标 Catalog 与相应生成物；
- 已说明兼容性影响、迁移策略、使用方和回滚或前向修复方式；
- 已指定独立 Reviewer；若同时改变 Harness、Contract、数据库或安全规则，还需对应 Skill。

## Procedure

1. 验证任务、Context Lock、Base Commit 和 Diff Scope。
2. 读取 `catalog-manifest.yaml`、目标 Catalog、引用它的 Contract、生成器和调用方。
3. 对新增/重命名/废弃 Code 逐项分析 API、事件、持久化、前端和历史数据兼容性。
4. 只修改 Catalog 真源，使用 `catalog_tool.py generate` 产生 `specs/generated/**`；不得手改生成物。
5. 运行 validate、generate/diff 和受影响的契约/模块测试。
6. 独立 Reviewer 复核 Code 唯一性、兼容性、生成物和 Diff Scope。

## Invariants

- 已发布 Code 不得静默复用为新语义；
- 生成物必须确定且与 Manifest 一致；
- Markdown 示例不能覆盖 Catalog；
- 产品范围开关变化必须有 Owner 批准，重大架构变化必须有 Accepted ADR。

## Stop Conditions

- 兼容策略、历史数据迁移、Owner 或消费方不明确；
- 需要手改生成物、放宽校验器或越过任务白名单；
- 变更实际属于 Contract、数据库、安全或 Harness 且缺少对应授权。
