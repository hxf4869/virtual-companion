# TASK-0174：Generation HTTP 纵切（async intake → work_item → handler → snapshot 轮询）

```yaml
taskId: TASK-0174
state: ACCEPTED
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  database-migration: "1.0.0"
targetSkillVersions: {}
baseCommit: a36b36e2ab76b66ad410c2f568468f8bd3fc850a
authorizationCommit: "plan-approved-2026-08-12-generation-vertical-slice"
deliveryMode: single-card
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - git diff --check
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationCreateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/web/ConversationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/web/GenerationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0174-generation-http-vertical-slice.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0174/**
  - docs/handoffs/TASK-0174.json
forbiddenPaths:
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V2[0-4]__*.sql
  - service/platform/persistence/src/main/java/**
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/**/pom.xml
  - specs/**
  - scripts/harness/**
  - skills/**
  - ci/**
  - frontend/**
  - AGENTS.md
  - CLAUDE.md
  - docs/tasks/TASK-01[5-7][0-3]-*
```

## 背景与目标

后端引擎/DB 完整（LiveModelInvoker + adapters + generation SD 函数族），但**中间断了**：
无 HTTP intake、worker 用 LoggingWorkItemHandler stub、LiveModelInvoker 无调用者。本卡打通
generation 端到端可观察链路：HTTP 创建 → 入队 work_item → coordinator poll → handler
terminalize → 客户端 snapshot 轮询。真实模型调用（LiveModelInvoker.invoke 构建完整
LiveInvocationRequest）留后续卡（需 routing inputs 设计）。

## 范围内

1. **V25 migration**：4 个 SD 函数 + 2 sequence（create_conversation / enqueue_work_item /
   promote_generation / conversation_id_seq + work_item_id_seq），GRANT EXECUTE vc_api，
   SET search_path=vc,pg_catalog，不改 V1-V24/不 REVOKE/不新增表列约束角色。
2. **3 persistence service**：WorkItemEnqueueService / ConversationCreateService /
   GenerationStateService（JdbcTemplate 包装，照 GenerationReceiveService 模式）。
3. **2 HTTP 端点**：POST /api/v1/conversations（create）+ POST intake + GET snapshot
  （@AuthenticationPrincipal(expression="accountId") 避免 Modulith 跨模块依赖）。
4. **GenerationWorkItemHandler**：替换 LoggingWorkItemHandler；promote IN_PROGRESS →
   terminalize FAILED_FINAL（providers disabled 降级 / integration pending）；非 GENERATION
   kind skip；异常 best-effort terminalize + rethrow。
5. **AuthDataSourceConfig**：+6 persistence service @Bean + workItemHandler bean 替换。
6. **测试**：DB test 65（create_conversation + enqueue + promote 正负）+ handler unit test
   4 场景 + SchemaReadiness 24→25。

## 范围外

- LiveModelInvoker 成功路径（invoke → record_provider_attempt → candidate → finalize
  COMPLETED）：需 LiveInvocationRequest 构建（RoutingRequest authorization snapshot /
  entitlement / protocol），留后续卡。当前 handler 降级 FAILED_FINAL。
- realtime SSE 推送、listMessages / cancelGeneration 端点、relationship HTTP 端点。
- ID 编码 hashid codec（当前 Long.parseLong，alpha 暴露真实 id）。
- canonical precheck / 完整 unittest discover（Owner 2026-08-12 "暂时不跑长时间检查"）。

## 验收标准

1. V25 四函数 + 两 sequence GRANT vc_api；run-rls-tests.sh 65/65 PASS。
2. intake 端点：receive + enqueue（首次 created）；重复 idempotencyKey 幂等不重复入队。
3. snapshot 端点：返回 status + events。
4. handler：GENERATION → promote IN_PROGRESS → terminalize FAILED_FINAL；非 GENERATION skip。
5. runtime mvn -pl runtime -am test BUILD SUCCESS（254/0/0）。
6. git diff --check exit 0。
7. Evidence 如实标注 canonical/unittest deferred + model invocation pending。
