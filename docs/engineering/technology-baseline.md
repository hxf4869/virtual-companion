# 技术基线

## 当前锁定

| 层 | 基线 | 说明 |
| --- | --- | --- |
| Java | 25 LTS | 与 `.harness/tools.lock.yaml` 和 Product Scope 一致 |
| Maven | 3.9.16 | Maven Wrapper 3.3.4，发行包 SHA-256 已锁定 |
| Spring Boot | 4.1.0 | Java 25 在官方兼容范围内 |
| Spring AI | 2.0.0 | 只导入 BOM；TASK-0001 不接模型、不启用 Starter |
| Spring Modulith | 2.1.0 | Runtime 引入核心与测试支持，后续业务模块按纵切加入 |
| Node.js | 22 | uni-app CLI 的兼容 LTS 基线 |
| pnpm | 11.9.0 | 前端必须提交锁文件并使用 frozen lockfile |
| 前端 | uni-app + Vue 3 + TypeScript + Pinia | TASK-0001 只提供 H5 工程和开发基线页 |

机器真源中的版本线高于本文的叙述性说明；如二者冲突，以 `.harness/tools.lock.yaml`、`specs/catalog/product-scope.yaml` 和生成 Catalog 为准。Major 升级必须先有新的 READY 任务和 ADR。

## 本任务未激活的组件

PostgreSQL、pgvector、Flyway、Spring JDBC、JobRunr、Keycloak、LiteLLM、Valkey、Langfuse、真实模型和任何付费软件能力均未接入。本任务不创建数据库、不读取真实用户数据，也不提供聊天 API。

## 本机构建

Windows 本机具备 JDK 25 时：

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build:h5
```

Windows 未安装 JDK 25 时，可使用 WSL2 内的 Docker：

```powershell
.\scripts\dev\maven-verify.ps1
```

开发容器锁定为 `maven:3.9.16-eclipse-temurin-25-noble@sha256:7e461cec477077c1d9e50b13df8aef9018764410f4c4cd7c34803f10c4c99e4c`，并使用仅保存 Maven 依赖的 `virtual-companion-maven-cache` Docker Volume。应用发布镜像仍须在独立发布任务中设计和锁定。

Maven Wrapper 来源为 Apache 3.3.4 `only-script` 发行包。仓库保留两处已验证的最小兼容补丁：Windows 脚本允许普通非符号链接的 `.m2` 目录；Unix 脚本在镜像缺少 `unzip` 时使用 JDK `jar` 解压 ZIP 并恢复 `mvn` 执行权限。两条路径均继续校验同一个 Maven 发行包 SHA-256，不允许关闭校验绕过问题。

## 依赖边界

- `service/platform/catalog` 只编译 `specs/generated/java`，不得复制或手写 Catalog Code。
- `service/apps/runtime` 只承载应用装配、Actuator 和内部基线端点。
- 业务能力后续按独立 Spring Modulith 模块纵向加入，不把模块包直接堆进 Runtime。
- Spring AI、供应商 SDK、数据库驱动和任务框架必须位于后续明确的 Port/Adapter 任务中。
