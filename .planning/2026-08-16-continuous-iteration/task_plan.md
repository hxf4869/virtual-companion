# Task Plan — virtual-companion 持续迭代

## Goal

持续迭代：按需求文档（docs/source V0.3 需求与技术方案）产出高价值缺口清单并逐项落地，
每项满足「代码 + 测试 + 契约/文档同步 + check.sh 全绿」验收口径。

## Current Phase

Phase 6 — 完成：COMP-CFG（FR-COMP-003）。下一项需 Owner 确认 QUOTA-MIN
解冻边界，或从 findings 新发现的 Alpha 项中挑选。

## Phases

### Phase 0: 现状盘点与缺口清单
- [x] 读 README/TODO/specs/需求文档/代码结构
- [x] 缺口清单与路线图写入 findings.md
- **Status:** complete

### Phase 1: CHAT-MODE 对话模式纵切
- [x] OpenAPI + V34 迁移 + 域/持久化 + 组装器 + 前端 chips + 测试 + 文档
- [x] check.sh / mvn verify / 前端 410 / DB 89 全绿，commit 7da2d31
- **Status:** complete

### Phase 2: FEEDBACK 生成反馈纵切
- [x] catalog message-feedback-kinds + V35 迁移（表 + SD 函数）
- [x] OpenAPI POST /generations/{id}/feedback + dist 重生成
- [x] 持久化服务 + 控制器 + bean 接线
- [x] 前端 api/store/页面一键反馈 chips + 测试
- [x] check.sh / mvn verify / 前端 / DB 90 全绿，commit 827709a
- **Status:** complete

### Phase 3: ADMIN-OPS 成本统计 + 管理员审计日志
- [x] V36 审计 keyset + 按日用量成本 SD + OpenAPI + AuthService + admin 页
- [x] check.sh / mvn verify / DB 91 全绿，commit 7c898b7
- **Status:** complete

### Phase 4: MSG-DELETE 单条消息删除 + SVC-MODE + INC-MODE
- [x] MSG-DELETE：V37 delete_message SD + DELETE 端点 + 两步确认 UI，commit fb8de92
- [x] SVC-MODE：GET /api/v1/service-mode + 聊天页明文状态行（reset 不清除），
      commit a0cbf97
- [x] INC-MODE：V38 conversation.incognito（创建冻结 + 列表回传）+ 无痕跳过
      MEMORY_EXTRACT + 前端开关/标记/说明，commit 821b07b
- **Status:** complete

### Phase 5: 新模块与剩余 P1 项
- [x] REMINDER 结构化提醒模块：V39 表+五个 SD 函数+OpenAPI 四端点+前端
      「提醒管理」页+三层测试，commit 01f59ea
- [x] ENT-SNAP 模拟权益快照：V40 分配表+不可变快照表+组装器路由接线+
      admin 页分配区，commit 1c1b6b9
- [x] CONSENT 版本化同意记录：V41 追加式表+record/list SD+OpenAPI 两端点+
      前端同意管理页+三层测试，commit f0db5fa
- [x] DATA-EXPORT 数据导出：V42 七 SD+OpenAPI 三端点+worker 聚合+过期清扫+
      前端导出页+三层测试，commit 3c6f7e9
- [x] ACCT-DELETE 账号注销：V43 自助注销 SD+级联清理+审计保留+墓碑+
      边界台两步确认，commit 7920b6e
- [x] REQUEST-ID 请求关联日志（FR-CHAT-001 request_id）+ MSG-COPY 消息复制，
      commit 72d1712
- [x] MEM-NEG 不记住负向标记：V44 消息级 no_memory+SD+worker 跳过+前端开关，
      commit f4a05a5
- [x] AGE-MIN 成年识别端口：V45 结果持久化+独立端口+模拟验证器+转移表，
      commit 90bb378
- [x] VIRT-LIST 聊天列表渲染窗口（§18.6，200 条上限+截断提示），commit f50b7bf
- [x] AUTH-RECHECK 撤回即失效快照（FR-AUTH-005 执行前复核闭环），commit 6de39ea
- [x] 全部 P0-P3 缺口已闭环（SAFETY/QUOTA 为 Owner 冻结项除外）
- **Status:** complete

### Phase 6: COMP-CFG 角色结构化配置（FR-COMP-003）
- [x] catalog companion-prefs（回复长度/主动/幽默/建议/回避话题）
- [x] OpenAPI PATCH /relationships/{id} + Relationship 扩展字段
- [x] V47 relationship 结构化列 + update/get/list SD
- [x] 组装器把目录码翻译为批准片段（昵称/称呼消毒，禁止自由 Prompt）
- [x] 前端「角色设置」页 + api/store/页面测试
- [x] check.sh / mvn / 前端 / DB 全绿并提交
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 每 Phase 一个 commit | 小步提交，可追溯 |
| 契约优先 | ADR-0002 contract-first；先 OpenAPI 再 generate dist 再实现 |
| 模式域用 AUTO/LISTEN/DISCUSS | Alpha 范围只承诺 LISTEN/DISCUSS；CASUAL 留给后续模板评估 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| （暂无） | |
