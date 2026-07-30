# TASK-0034：成熟身份组件与内部测试账号接入（硬决策闸门）

```yaml
taskId: TASK-0034
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: fe4366dec2647c81fc50dcf6f62f99e45183b3598c9f213377cba607d4faba8c
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

在 Owner 批准供应商、登录渠道和会话策略后接入成熟身份组件与内部测试账号。

## 范围内

- 供应商中立身份端口、服务端验证映射和内部账号供给；
- H5 凭据、CSRF、Origin、会话撤销和审计。

## 明确禁止

- 公开注册、共享固定生产身份和自研认证核心；
- 客户端 `owner_user_id` 或开发 Header 成为身份真源；
- 猜测 IdP、登录渠道、账号供给或会话策略。

## 依赖与决策闸门

- 依赖：TASK-0025、TASK-0026；
- 硬闸门：`GATE-IDENTITY-PROVIDER-SESSION`。

## 验收

- 外部身份、`owner_user_id` 与认证会话映射失败关闭；
- 内部测试账号不开放公开注册且敏感数据不进日志、URL 或模型。

## 晋级规则

只有依赖全部 ACCEPTED，且硬闸门在 Backlog 中由 Owner 记录完整审批证据并为 APPROVED 时，才可晋级；否则保持 PLANNED/BLOCKED。
