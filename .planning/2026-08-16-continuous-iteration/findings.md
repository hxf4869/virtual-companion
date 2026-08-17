# Findings — 持续迭代缺口分析

## 现状盘点（2026-08-16 第五轮后）

- 后端 14 模块：Auth/Conversation/ModelRuntime/Safety/Persistence 纵切已接通（Generation/Realtime/Memory 全链路）。
- OpenAPI 合同面已全部实现；V1–V33 迁移；H5 页面：Login/Chat/Memory/Admin/Index。
- Owner 决定（2026-08-15）：SAFETY 分类器接线维持现状；COORD/QUOTA 维持现状。**不得触碰**。
- 需求真源：`docs/source/虚拟对象_AI陪伴项目_V0.3_产品需求与技术方案.md`（10573 行）与
  `docs/source/AI虚拟陪伴系统技术架构与成熟组件接入方案.md`。
- 契约生成：`python3 scripts/dev/openapi_tool.py generate`（contract-first）；
  目录：`python3 scripts/checks/catalog_tool.py generate`。specs/generated 与 openapi/dist 禁手改。

## 高价值缺口清单（需求 vs 实现，Alpha 范围内优先）

### P0 会话/聊天域（Alpha 范围，闭环体验）

1. **CHAT-MODE 对话模式**（FR-CHAT-002）：✅ 已交付（7da2d31，V34 + OpenAPI
   mode + 组装器轮次指令 + 前端 chips）。
2. **FEEDBACK 生成反馈**（FR-CHAT-003）：✅ 已交付（827709a，V35 表/SD +
   POST /generations/{id}/feedback + 聊天页一键反馈）。
3. **MSG-DELETE 单条消息删除**（FR-CHAT-004 / FR-DATA-003）：✅ 已交付
   （fb8de92，V37 delete_message SD + DELETE 端点 + 两步确认 UI）。
4. **INC-MODE 无痕会话**（FR-CHAT-005）：✅ 已交付（821b07b，V38 创建冻结 +
   跳过记忆提取 + 前端开关）。
5. **消息操作补充**：复制（72d1712，MSG-COPY）与「不记住」（f4a05a5，
   MEM-NEG V44：消息级 no_memory、worker 跳过、可逆）均已交付。

### P1 账号/同意/数据权利域

6. **CONSENT 同意记录与授权快照 UI**（FR-AUTH-003/005）：✅ 已交付（commit
   f0db5fa）——V41 追加式版本化表 + record/list SD + PUT/GET /api/v1/consents +
   前端同意管理页；执行时授权复核闭环由 AUTH-RECHECK（6de39ea）补齐：撤回
   同意即同事务失效全部 ACTIVE 快照，guard 执行前拒绝（未执行任务不得用
   旧授权对外发送，FR-AUTH-005 达成）。
7. **ACCT-DELETE 注销**（FR-AUTH-004）：✅ 已交付（7920b6e）——V43 自助注销
   SD（审计→删 vc_user 根行级联清理）+ 删除墓碑（登录/refresh 立即失效、
   恢复不可能）+ 前端两步确认危险区（保留期/合规日志说明）。
8. **DATA-EXPORT 数据导出**（FR-DATA-002）：✅ 已交付（3c6f7e9）——V42
   七 SD + OpenAPI 三端点 + worker 聚合（AI 内容标识）+ 一次性短效下载 +
   过期自动清除；Alpha 内联 payload 存储（无对象存储）。
9. **AGE 成年识别端口**（FR-AUTH-002）：✅ 已交付（90bb378）——V45 结果
   持久化（不存身份证）+ 独立 AgeVerificationPort + 模拟验证器 + 转移表
   镜像（catalog age-states 已备）；Beta 门禁依赖 ageStateRequired=
   ADULT_VERIFIED 未接线到生成链路（真实用户开放前的前置）。

### P1 权益/降级域（Alpha 要求 A3，尚未完成）

10. **ENT-SNAP 测试权益快照**（A3-001/FR-ENT-004）：✅ 已交付（1c1b6b9，
    V40 分配表+不可变快照+组装器路由接线+admin 分配区）。
11. **QUOTA-MIN 最小额度预留**（A3-003）：QuotaLedger 存在但 RESERVED/COMMITTED/RELEASED
    生命周期未接进 worker 链路（Owner 说 QUOTA 维持现状——需确认边界后谨慎）。
12. **SVC-MODE 服务状态透明**（FR-RES-005）：✅ 已交付（a0cbf97，GET
    /api/v1/service-mode + 聊天页明文状态行）。

### P2 新模块（Beta 范围，提前打地基）

13. **REMINDER 提醒模块**（FR-NOTIFY-001）：✅ 已交付（01f59ea，V39 表+五 SD+
    OpenAPI 四端点+提醒管理页；不实现主动推送）。
14. **SAFETY-CASE 高风险队列**（B0-002，Owner 已冻结 SAFETY，跳过）。
15. **ADMIN-OPS 最小内部管理台**（B0-005）：✅ 已交付（7c898b7，V36 审计
    keyset + 按日用量成本 SD + GET /auth/admin/audit、/auth/admin/usage +
    admin 页两区块）。
16. **语音/图片**：v1 后单独评估，不做。

### P3 工程质量

17. **OBS 可观测性**：✅ 已交付（72d1712）——RequestIdFilter 为每个 HTTP
    请求生成/透传 X-Request-Id（MDC + 日志 [req=...] + 响应回显），
    FR-CHAT-001 的 request_id 落地；generation_id 关联已由 worker 日志承担。
18. **前端长列表虚拟滚动**：✅ 已交付（f50b7bf，VIRT-LIST）——§18.6 列表
    性能以「按段加载 + DOM 渲染窗口上限 200 条 + 截断提示」达成；精确虚拟
    滚动（固定高度滚动容器改造）留待 Beta 前端专项。
19. **contract-tests 扩展**：新端点补 contract 测试。

## 约束（红线与既定决策）

- 不碰 SAFETY 接线、不做真实支付/公开注册、不提交凭据。
- 验收口径：代码 + 测试 + 契约/文档同步（OpenAPI dist、README、TODO）+ `bash scripts/check.sh` 全绿。
- 契约优先：先改 `specs/openapi/virtual-companion.yaml`，再 `python3 scripts/dev/openapi_tool.py generate`。
- 小步提交，每功能一 commit。

## 路线图（本轮会话）

1. ✅ CHAT-MODE 对话模式纵切（7da2d31）
2. ✅ FEEDBACK 生成反馈纵切（827709a）
3. ✅ ADMIN-OPS 成本/审计（7c898b7）
4. ✅ SVC-MODE（a0cbf97）/ MSG-DELETE（fb8de92）/ INC-MODE（821b07b）
5. ✅ REMINDER（01f59ea）/ ENT-SNAP（1c1b6b9）/ CONSENT（f0db5fa）/
   DATA-EXPORT（3c6f7e9）/ ACCT-DELETE（7920b6e）
6. 下一轮：P3 工程项（消息复制/不记住、request_id 关联日志、长列表
   虚拟滚动）
