# Progress Log

## Session: 2026-08-18 — COMP-PRES

### Current Status
- **Phase:** 7 完成（COMP-PRES / FR-COMP-002）。本会话交付第 20 项功能。
  QUOTA-MIN 仍冻结，未动手。

### Actions Taken
- 需求对照后选定 FR-COMP-002（性别与形象呈现；Owner 确认 QUOTA-MIN 保持冻结，
  从 Alpha 新发现项中挑选）。
- catalog companion-presentation（CompanionGender FEMALE/MALE/NEUTRAL +
  CompanionAvatar 平台审核素材引用）+ OpenAPI PATCH 增补 gender/avatarRef +
  V48 迁移（列 + update/get/list SD）+ 组装器性别批准片段（只呈现、不改变
  行为/安全/记忆规则）+「角色设置」页性别/平台素材头像选择（CSS 占位视觉，
  无照片上传；所有角色固定成年人设定）；schema readiness 钉到 V48。

### Test Results
| Test | Actual | Status |
|------|--------|--------|
| scripts/check.sh | 全绿（含 frontend-test / frontend-type-check） | PASS |
| ./mvnw verify（JDK 25） | BUILD SUCCESS（runtime 500 tests，0 失败） | PASS |
| pnpm frontend test:run | 517 passed | PASS |
| pnpm frontend type-check | 无错误 | PASS |
| infra/db/run-rls-tests.sh | ALL TESTS PASS（V1-V48，含 103） | PASS |
| 浏览器端到端 | Playwright MCP 未连接，未做真机点击 | NOT_RUN |

## Session: 2026-08-17 — COMP-CFG

### Actions Taken
- 需求对照后选定 FR-COMP-003（Alpha 最小能力「角色设置」/ A4 角色初始化）。
- catalog companion-prefs + OpenAPI PATCH + V47 + 组装器批准片段 +
  前端「角色设置」页；schema readiness 钉到 V47。

### Test Results
| Test | Actual | Status |
|------|--------|--------|
| scripts/check.sh | 全绿（含 frontend-test / frontend-type-check） | PASS |
| ./mvnw verify（JDK 25） | BUILD SUCCESS（runtime 498 tests，0 失败） | PASS |
| pnpm frontend test:run | 514 passed | PASS |
| pnpm frontend type-check | 无错误 | PASS |
| infra/db/run-rls-tests.sh | ALL TESTS PASS（V1-V47，含 102） | PASS |
| 浏览器端到端 | Playwright MCP 未连接，未做真机点击 | NOT_RUN |

## Session: 2026-08-16 — 持续迭代（Phase 1-5）

### Actions Taken
- Phase 0 盘点 → findings.md 缺口清单（P0/P1/P2 + 路线图）。
- Phase 1 CHAT-MODE（commit 7da2d31）：OpenAPI mode + V34 + 组装器轮次指令 +
  前端快捷模式 chips；check.sh/mvn/前端 410/DB 89 全绿。
- Phase 2 FEEDBACK（commit 827709a）：catalog message-feedback-kinds + V35
  表/SD + POST /generations/{id}/feedback + 聊天页一键反馈；全绿。
- Phase 3 ADMIN-OPS（commit 7c898b7）：V36 审计 keyset + 按日用量成本 SD +
  GET /auth/admin/audit + /auth/admin/usage + admin 页两区块；后端 442、
  前端 439、DB 91 全绿。
- Phase 5 CONSENT（commit f0db5fa）：V41 vc.consent_record 追加式版本化表 +
  record_consent/list_consents SD + PUT/GET /api/v1/consents + 前端
  「同意管理」页（8 类目录、生效态、同意/撤回、版本 2026-08）+ api/store/
  page 三层测试；check.sh/mvn/前端/DB 全绿。
- Phase 5 DATA-EXPORT（commit 3c6f7e9）：V42 export_request 表 + 七 SD
  （create/count/complete/fail/get/consume/expire）+ 入队复用 work_item
  队列 + OpenAPI 三端点（POST /exports、GET /exports/{id}、
  GET /exports/{id}/download 一次性消费）+ DataExportWorkItemHandler 聚合
  会话/消息（aiGenerated 标识）/记忆/提醒/同意 + ExportExpiryScheduler
  过期清扫（payload 清除）+ 前端「数据导出」页（发起/刷新/下载+预览）+
  api/store/page 三层测试 + DB 97；check.sh/mvn/前端 492/DB 全绿。
- Phase 5 ACCT-DELETE（commit 7920b6e）：V43 identity_account_delete SD
  （本人 ACTIVE 校验 → ACCOUNT_DELETE 审计 → 删 vc_user 根行级联清身份/
  refresh/业务数据；consent_record 补 owner FK；审计表无 FK 保留）+ OpenAPI
  DELETE /api/v1/auth/account（清会话 cookie）+ 前端边界台两步确认注销
  危险区（保留期与合规日志说明）+ AuthService/AuthController/前端 api/
  页面测试 + DB 98（级联/墓碑/审计/不披露）；check.sh/mvn/前端 497/DB 全绿。
- Phase 5 REQUEST-ID + MSG-COPY（commit 72d1712）：RequestIdFilter
  （X-Request-Id 透传/生成、非法头替换、MDC requestId、响应回显、CORS 暴露、
  日志 pattern [req=...]）+ 5 个单元测试；聊天页「复制」按钮（异步剪贴板 +
  legacy 回退、已复制反馈、streaming 行不渲染）+ 2 个组件测试；过程中发现并
  修复 application.yaml 结构损坏（logging 段误插进 spring 段导致
  DataSourceAutoConfiguration 排除失效）；check.sh/mvn/前端 499 全绿。
- Phase 5 MEM-NEG（commit f4a05a5）：V44 vc.message.no_memory（§16.2.5 规格）
  + set_message_no_memory SD（存在隐藏、可逆）+ list_messages 追加式
  DROP+CREATE 重定义透出 out_no_memory（search_path 保持 vc,pg_catalog，
  权限重新收紧，57 测试约束）+ MemoryExtractWorkItemHandler 跳过
  no_memory 用户消息 + OpenAPI PATCH /messages/{messageId} + 前端
  「不记住/恢复记忆」按钮（仅用户消息）+ DB 99/单元/组件测试；
  check.sh/mvn/前端 505/DB 全绿。
- Phase 5 AGE-MIN（commit 90bb378）：V45 vc.age_verification（追加式结果
  历史、不存身份证、9 状态 CHECK）+ record/get SD + AgeVerificationPort
  独立接口 + SimulatedAgeVerifier（catalog 转移图路径落历史、已认证幂等、
  未成年/申诉/暂停 fail-closed）+ AgeStateTransitions 镜像转移表（测试
  钉死 YAML）+ OpenAPI GET /age/state、POST /age/verification + DB 100/
  单元测试；check.sh/mvn 493/DB 全绿（前端无改动，Beta 门禁依赖）。
- Phase 5 VIRT-LIST（commit f50b7bf）：聊天列表 DOM 渲染窗口上限 200 条
  （§18.6 列表性能）+ 明文截断提示条 + 2 个组件测试（250 条→200 行+提示、
  未超限无提示）；纯前端，流式/自动滚动行为不变；check.sh/mvn/前端 507
  全绿。findings 缺口清单至此全部闭环。
- Phase 5 AUTH-RECHECK（commit 6de39ea）：V46 withdraw_authorization_snapshots
  SD（ACTIVE→WITHDRAWN 返回行数、幂等、仅 vc_api）+ ConsentService.record
  撤回时同事务失效全部 ACTIVE 快照（grant 不失效）+ ExecutionAuthorizationGuard
  对 WITHDRAWN 执行前 fail-closed（FR-AUTH-005 闭环：撤回后未执行任务不得
  用旧授权对外发送）+ DB 101/单元测试；check.sh/mvn 493/DB 全绿。

### Test Results
| Test | Actual | Status |
|------|--------|--------|
| scripts/check.sh | 全绿（含 frontend-test / frontend-type-check） | PASS |
| ./mvnw verify（JDK 25） | BUILD SUCCESS（1088+ tests，0 失败） | PASS |
| pnpm frontend test:run | 507 passed | PASS |
| pnpm frontend type-check | 无错误 | PASS |
| infra/db/run-rls-tests.sh | ALL TESTS PASS（V1-V46，1..101 全部测试） | PASS |

### Errors
| Error | Resolution |
|-------|------------|
| sum(bigint)→numeric 与 RETURNS bigint 不匹配（V36） | 显式 ::bigint |
| vc_api 直读业务表被拒（测试 90/91/100） | 断言移 superuser 会话；seed 走 SD |
| receive_generation 需 owner context（测试 91） | set_owner_context 后调用 |
| Mockito any() 在 JdbcTemplate.query 重载歧义 | 显式 any(RowMapper.class) |
| CREATE OR REPLACE 跨 OUT 类型变更被拒（V44） | DROP + CREATE，权限重新收紧 |
| logging 段误插进 spring 段致 DataSource exclude 失效 | 恢复 YAML 结构并全量验证 |

