# TASK-0001：项目仓库初始化与可运行骨架

```yaml
taskId: TASK-0001
state: DONE
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-intake
baseCommit: 85cc7393957bc8840207fabce25395dd9bad62bd
contextFingerprint: a790df0c92e1d237353a07c6848247729814e7d8c227a1af4ecf29101ee92c8e
contextLock: docs/tasks/context/TASK-0001.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - .harness/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - skills/task-intake/SKILL.md
  - docs/tasks/task-card-template.md
  - G:/ai/hxf/AI虚拟陪伴系统技术架构与成熟组件接入方案.md
  - G:/ai/hxf/虚拟对象_AI陪伴项目_V0.3_产品需求与技术方案.md
  - G:/ai/hxf/虚拟对象_V0.3.1_技术契约与机器真源起步包.zip
writeAllowlist:
  - .gitattributes
  - .gitignore
  - .github/**
  - README.md
  - pom.xml
  - mvnw
  - mvnw.cmd
  - .mvn/**
  - service/platform/catalog/**
  - service/apps/runtime/**
  - frontend/**
  - deploy/**
  - compose.yaml
  - docs/source/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/engineering/**
  - docs/evidence/TASK-0001/**
  - docs/handoffs/TASK-0001.json
  - docs/tasks/TASK-0001-project-bootstrap.md
  - docs/tasks/context/TASK-0001.context-lock.yaml
  - scripts/dev/**
forbiddenPaths:
  - .harness/**
  - scripts/harness/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - ops/**
  - service/**/identity/**
  - service/**/companion/**
  - service/**/conversation/**
  - service/**/memory/**
  - service/**/safety/**
  - service/**/entitlement/**
  - service/**/modelruntime/**
  - service/**/realtime/**
  - service/**/audit/**
  - service/**/notification/**
  - service/**/userdata/**
  - db/migration/**
sourcesOfTruth:
  - .harness/phase-scope.yaml
  - .harness/sources-of-truth.yaml
  - .harness/tools.lock.yaml
  - specs/catalog/product-scope.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/realtime-contract.yaml
requiredInvariants:
  - INV-COST-001
requiredCommands:
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - python scripts/harness/check_paid_features.py
  - ./mvnw verify
  - pnpm --dir frontend build
  - git diff --check
reviewers: []
```

## 背景与用户可观察目标

把 V0.3.1 技术契约起步包建立为独立 Git 仓库，并创建一个可复现构建的 Java/Spring 与 uni-app H5 项目骨架。完成后，开发者可以在不接真实模型、不创建业务表、不开放真实用户的情况下启动后端健康检查和前端项目，后续业务纵切拥有明确目录、版本、真源和门禁。

## 范围内

- 保存未经修改的 V0.3.1 起步包基线提交；
- 将产品方案和技术架构复制到 `docs/source/`；
- 形成技术基线、模块边界和关键 ADR；
- 建立 Maven 聚合工程、Catalog 编译模块和单一后端 Runtime 骨架；
- Runtime 只提供健康、版本和 Catalog 基线查询，不实现聊天业务；
- 建立 uni-app + Vue 3 + TypeScript + Pinia 的 H5 骨架；
- 接入 GitHub Actions 的 Harness、后端和前端基础检查；
- 提供 Windows/WSL 可复现的开发启动说明；
- 创建 Evidence Pack 和 Handoff。

## 明确范围外

- 用户、会话、消息、记忆、安全、模型路由等业务实现；
- 数据库 Migration、RLS、Worker Claim 和授权快照实现；
- 真实模型、LiteLLM、JobRunr、Keycloak、Valkey、Langfuse；
- 真实登录、公开注册、支付、语音、图片、WebSocket；
- 修改 Catalog、Contract、生成器、Harness 或 Beta 值班表；
- 创建或推送 GitHub 远程仓库。

## 输入和前置条件

- Base Commit 为未经修改的 V0.3.1 起步包；
- 起步包 ZIP 与 `MANIFEST.sha256` 校验通过；
- Spring Boot 4.1.0 官方要求 Java 17+，本项目按机器真源使用 Java 25 LTS；
- Windows 当前仅有 Java 8，后端验证需使用 Maven Wrapper 配合 JDK 25 或容器工具链。

## API / 事件 / 数据契约

- 本任务只允许新增 `/actuator/health` 和只读的 `/api/internal/baseline`；
- 不新增聊天、Generation、SSE、记忆或安全业务事件；
- 返回的 Catalog Code 必须来自 `specs/generated/java`，不得手写同义枚举。

## 权限、RLS 和数据处理要求

- 不接收、保存或发送真实用户数据；
- 不创建绕过 RLS 的数据库角色；
- 不把密钥、Token、真实联系方式或本机凭据写入仓库。

## 状态机和失败行为

- Runtime 缺少必要配置时启动失败并给出非敏感错误；
- 前端无法访问后端时展示明确的本地开发状态，不伪造成功数据；
- Harness、后端或前端任一必跑检查失败，任务不得标记完成。

## 模型、Prompt、记忆和安全边界

- 本任务不调用模型，不创建 Prompt，不读写 Canonical Memory；
- 不实现 Fake/Failure/ZERO_LLM，它们进入后续独立 READY 任务；
- 不修改安全策略和风险 Catalog。

## 验收标准

1. 仓库位于 `main` 分支，工作区只包含本任务白名单内变更。
2. Catalog validate 和 drift 检查通过，受保护真源零修改。
3. Maven 聚合工程在 Java 25 工具链中完成 `verify`。
4. Spring Boot Runtime 测试验证应用上下文和只读基线接口。
5. 前端存在锁文件并完成 H5 生产构建。
6. GitHub Actions 文件位于 `.github/workflows/`，能执行 Harness、后端和前端检查。
7. `.gitignore` 排除密钥、构建产物、依赖缓存和本地 IDE 文件。
8. README 给出 Windows、WSL 和容器化构建路径，不声称未执行的启动验证。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令必须记录退出码和执行环境。

## 回滚或前向修复

项目骨架尚无用户数据。发生问题时优先对本任务提交做前向修复；如需回退，仅回退 TASK-0001 引入的文件，不修改起步包基线提交。

## 停止条件

- 需要修改 `.harness/**`、`specs/catalog/**`、`specs/contracts/**` 或 `specs/generated/**`；
- 发现稳定版本无法相互兼容且需要修改机器真源；
- 构建要求安装或依赖付费软件功能；
- 需要真实模型密钥、用户数据或 GitHub 写权限才能继续本地工作。

## Evidence Pack

输出到 `docs/evidence/TASK-0001/`，并生成 `docs/handoffs/TASK-0001.json`。

实现代码验证点为 `ab62e45abc674cffd167805c11d8e924c6d32be1`，CI 修复验证点为 `3b43a1b418872e5ea428732bc79d26abcb632af2`；机器检查见 `docs/evidence/TASK-0001/evidence-pack.json`，恢复与剩余事项见 `docs/handoffs/TASK-0001.json`。
