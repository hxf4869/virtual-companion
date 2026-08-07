# R1 独立复核：TASK-0034 成熟身份组件

- 复核人角色：独立 R1 reviewer（未参与实现）
- 复核 commit：`280c002`（实现候选），diff = `c44b88f..280c002`（49 文件，+4114/-5）
- 复核日期：2026-08-07
- 复核性质：C4（database-migration 保护面 + Spring Security/JWT 自托管鉴权）独立复核

## Verdict：PASS

无 P0/P1，无 AC/不变量违反。`git diff --check` 干净，工作树干净。8 个审查维度全部 PASS，验收标准 AC1-7 逐条满足，writeAllowlist 程序化核对 49/49 文件全覆盖，实现 diff 零 forbidden 路径触碰。6 条 P3 非阻塞发现（记录于下）。

## 逐项确认

1. **V14 迁移（PASS）**：全部 8 个 SECURITY DEFINER 函数均 `SET search_path = vc, public`；REVOKE PUBLIC + 仅 GRANT EXECUTE TO vc_api 完整；身份表无直接 DML、无 RLS（平台级对象，非 owner-scoped）；跨账号 logout 拒绝、未知/撤销/过期/DISABLED token 统一空结果不披露；id==owner_user_id（FK→vc_user ON DELETE CASCADE）+ vc_user/identity_account 原子插入；密码仅 BCrypt 哈希、refresh 仅 sha256 hex；`identity_refresh_token_rotate` 增加 `out_username` 后与仓储读取一致，用于重签 access token，行为正确。
2. **Spring Security + JWT（PASS）**：filter chain 中 login/refresh/health public、`anyRequest().authenticated()`、401 entry point 返回 AUTHENTICATION_REQUIRED JSON、CORS 白名单 + allowCredentials(false)、无 cookie 故 CSRF disabled、STATELESS。jjwt 0.12.6（api/impl/jackson 分离）、HS256、secret≥32 字节构造时强制、issuer 必填并 requireIssuer 校验；过期/篡改/跨 issuer/空 token 全部 fail-closed 返回 null，均有单测。Filter 仅从 Bearer 建立 principal（accountId==owner_user_id），数据库无关。
3. **AuthService（PASS）**：未知用户与错误密码统一 NOT_FOUND_OR_FORBIDDEN + dummy BCrypt 计时均衡；DISABLED → AUTHENTICATION_REQUIRED；refresh 走 DB rotate（未撤销+未过期+ACTIVE 原子校验）再 Java 二次 status 检查；logout 幂等不披露；建号仅 ADMIN（服务层 role 检查 + DB 函数再检 ACTIVE ADMIN）+ 重复用户名 UNIQUE 冲突映射 generic；凭据不进日志/URL/模型。
4. **OwnerContext（PASS）**：`set_config('vc.owner_user_id', ?, true)` 事务绑定接 RLS（INV-TENANT-001），与 V1 RLS helper `current_setting('vc.owner_user_id')` 一致；accountId==owner_user_id 直映，principal 仅来自服务端验证 token。
5. **前端（PASS）**：transport 注入式（镜像 TASK-0026/0030）；token 注入 + 401→onUnauthorized（清会话+跳登录）；refresh 的 401 同样清会话 fail-closed；token 仅入 localStorage，不读聊天草稿/记忆、不进模型上下文。
6. **OpenAPI（PASS）**：bearerAuth scheme + 4 端点（login/refresh/logout/admin/accounts）；错误复用既有 AUTHENTICATION_REQUIRED/ACCESS_DENIED/NOT_FOUND_OR_FORBIDDEN，零 catalog/generated 改动；openapi.snapshot.json 含 4 个新 operationId；dist java/TS 生成一致。
7. **writeAllowlist / 边界（PASS）**：实现 diff 全部 49 文件均在 writeAllowlist 覆盖下；零 forbidden 路径。
8. **AC1-7（全部 PASS）**：RLS 39/39、Maven runtime 70 测试、openapi validate/diff、vitest 93 + vue-tsc、无明文凭据泄漏审计、未认证→AUTHENTICATION_REQUIRED 集成测试、precheck/unittest/diff-check 均已由实现会话执行验证。

## Findings（全部 P3，非阻塞）

1. **P3** — `identity_authenticate` SECURITY DEFINER 只接收 username、返回 BCrypt 哈希，任何能执行该函数的 vc_api 会话可枚举用户名并取回哈希（供离线爆破）。这是批准方案（Spring Security BCrypt 在 JVM 比较）的固有权衡，与闸门一致，非缺陷。
2. **P3** — 无状态 access token（2h）不可服务端撤销；账号 DISABLED 后已签发 token 在过期前仍可鉴权。与闸门一致（仅 refresh 服务端有状态撤销），刷新路径已对 DISABLED 失败关闭。
3. **P3** — token 存 localStorage，XSS 会暴露。H5 标准模式，Alpha 内部工具可接受。
4. **P3** — `OwnerContext` 用 `jdbc.update("SELECT set_config(...)")` 执行 SELECT（功能正确），用 `execute()` 更惯用。纯风格。
5. **P3** — chat/memory 既有 transport 尚未注入 Bearer（页面冻结、后续任务接线）。一旦 `VC_AUTH_ENABLED=true`，既有 H5 聊天/记忆页会 401 直到后续接线；属任务卡明确范围外推迟项。
6. **P3** — 测试 39 的 DISABLED issue 负例用 `BEGIN…EXCEPTION WHEN OTHERS THEN NULL` 吞任意异常；rotate 负例断言精确，无安全问题。
