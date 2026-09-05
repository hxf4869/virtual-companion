# 前端纠偏式重构——删除过度设计，重建可用的移动端产品（唯一长线计划）

> **SUPERSEDED（2026-09-01）**
> 本计划已被
> [`2026-09-01-frontend-redo-implementation-plan.md`](./2026-09-01-frontend-redo-implementation-plan.md)
> 取代，仅保留为历史记录。本文的“纠偏式重构”、20 路由兼容、四项底部导航、禁止修改接口与
> 禁止新增依赖等要求，均不再是实施约束。

- 日期：2026-08-29
- 执行者：zcode（本任务唯一前端写入 Owner）
- 分支：`codex/frontend-simplification-redesign`（自 `db8815e4` 创建）
- 旧计划：`docs/planning/2026-08-26-frontend-product-reconstruction.md` 已标记
  SUPERSEDED，仅作历史追溯；其视觉方向（The Lit Window）、seed `d2f84655`、
  Round 1–11 的逐像素锚定目标与帧级证明自本文起不再具有实施约束力。

## 1. 任务定义

这不是继续完善旧重构，而是纠偏。c52fbae3..db8815e4 累计 88 文件、约 +18,991/-4,760，
chat.vue 4,413 行、chat.spec.ts 4,441 行、Journey03 2,507 行。聊天页成为滚动算法
实验场、状态面板和卡片集合。本任务删除本轮累积的过度设计、过度防御和实现耦合
测试，把全部 20 个路由重新设计成正常、熟悉、可理解的移动端 H5 产品。

单一目标：

1. 删除本轮累积的过度设计、过度防御和实现耦合测试。
2. 保留真正有产品价值和安全价值的修复。
3. 将全部 20 个路由重新设计成正常、熟悉、可理解的移动端 H5 产品。
4. 聊天页恢复为普通聊天产品。
5. 显著降低生产代码和测试复杂度。
6. 一次有界视觉检查、一次最终验证，然后停止。

不得用新增更多状态、token、epoch、observer、pump、诊断字段和重试解决复杂度问题。

## 2. 基线与边界

- 基线 `db8815e4`，工作树 clean，基线 `bash scripts/check.sh` PASS（2026-08-29，12s）。
- 禁止 push / merge / rebase / 修改 main / reset 覆盖未知改动。
- 只允许修改：`frontend/src/pages/**`、`frontend/src/app/**`、
  `frontend/src/design-system/**`、`frontend/src/components/**`、与展示有关的
  domain helper、相关测试与 E2E、`frontend/DESIGN.md`、
  `frontend/.impeccable/design.json`、`frontend/index.html` 旧视觉契约、两个
  planning 文档。
- 原则上只读：`frontend/src/api/**`、`frontend/src/stores/**`、`frontend/src/domain`
  中协议/权限/状态机逻辑（除非直接可复现的前端缺陷）。
- 禁止：后端 Java、OpenAPI、Catalog、migration/RLS/数据库、Provider 契约、
  SSE 租约后端实现、产品范围（公开注册/支付/语音/图片/WebSocket）。
- 禁止新增生产依赖。
- 旧方案失效清单：The Lit Window、seed d2f84655、逐像素锚定、≤4px 精度、
  20/8/7ms 与 120/144Hz 帧级证明、PreserveTransaction 生命周期证明、诊断
  dataset/phase/generation/pump 作为成功标准、补丁式继续。

## 3. 视觉方向（已决定，不再等待 Owner）

目标："熟悉、安静、清晰、浅色优先的移动端陪伴产品。" 这是产品界面，不是品牌海报。

- 浅色中性背景、白色/轻微区分内容面、接近黑色的主文字。
- 一种克制、低饱和的冷色品牌强调（蓝/青方向）。
- 禁止：AI 紫粉、琥珀主题、大面积深蓝壳、The Lit Window、墨蓝持久页头底栏、
  暖纸/琥珀灯光/夜景隐喻、玻璃拟态、大面积渐变、卡片套卡片、每区块圆角容器、
  超大空白、chip/badge/pill 泛滥、emoji 结构图标、营销大标题、装饰性英文
  kicker、低对比灰字、阴影造层级、无功能装饰、首页仪表盘、聊天状态控制台。
- 中文系统字体，无外部字体。以常见 iOS/Android 移动端产品为熟悉度基准。
- 移动端基准：390×844 主设计；375×812 小屏；812×375 横屏；768×1024 平板；
  1200×900、1440×900 桌面。
- 硬性：正文和输入 ≥16px；触控目标 ≥44×44px；图标相邻操作间距 ≥8px；清晰
  焦点态；兼容 prefers-reduced-motion；不禁用缩放；无横向溢出；处理 safe-area；
  键盘不遮挡输入；一屏一个主动作；卡片仅用于真实分组；危险操作明显分离；
  底部导航仅四个顶层入口（图标+文字）；二级页普通返回导航；桌面是移动布局的
  自然扩展。

impeccable / ui-ux-pro-max 仅用于 critique、distill、layout、typeset、adapt、
accessibility、最终 audit；不使用 overdrive/delight；最多一次初始批量评审和
一次修复确认。

## 4. 必须保留（Keep）

1. 四入口信息架构（首页/对话/记忆/我的）与 Shell 归属
   （consumer-tab / immersive / consumer-sub / admission / internal）。
2. 当前路由、query、深链和返回栈兼容（`app/navigation.ts` 的 ROUTES 表为准）。
3. 权限矩阵：ops 仅 ADMIN；admin 允许 ADMIN/SAFETY_REVIEWER/PRIVACY_OPERATOR/
   OPS_VIEWER；USER 不显示内部入口。
4. 消费者安全展示：密文标题不直出、内部 ID 不作标题回退、enum 转中文、时间
   本地化、敏感日志脱敏。
5. 真实 SSE 能力（api/realtime.ts 侧）：单连接逐帧草稿、正式终态只一份、
   abort/gap/reset/duplicate 序列语义、终态后迟到事件不篡改结果。
6. 会话切换防旧请求串写新会话（store 的 historyWindowToken）。
7. 同一消息删除单飞（重复确认只发一个 DELETE）。
8. AI 非真人、状态真实性、记忆控制、数据权利和危险操作确认。

## 5. 必须删除（Remove，全仓生产代码归零）

PreserveTransaction、preserve pump/epoch/revival/phase、frozen top pad、
preserve window override、per-row measured height cache、手写变高虚拟列表
spacer、ScrollEchoAck/echo ticket pool、layoutCascadeSh、followGen 多代身份
协议、self window token、帧预算/稳定批次/320ms quiet window、递归或持续 rAF
pump、data-preserve-*、data-follow-run 等诊断属性、120/144Hz 生命周期硬证明、
跨宽度/删除 ≤4px 锚定承诺。禁止改名搬家到 composable/domain/helper。

## 6. 聊天滚动系统唯一方案

CSS flex + 100dvh；history 为 flex:1 + overflow-y:auto；composer flex:none；
不 fixed composer；无 per-row ResizeObserver；无虚拟 spacer。

允许的滚动状态只有：`isFollowingLatest`、`pendingScrollFrame`（合并后的
rAF，最多一个）、可选 `prependSnapshot`（加载旧消息前的 scrollHeight/scrollTop）。

行为：接近底部 → 跟随；向上滚离 → 停止跟随，流式/新消息不抢位置；显示轻量
"回到最新"按钮；点击或按 End 恢复跟随；跟随时新内容用 nextTick + 最多一个
rAF 滚到底；同一帧多次更新合并一次写入；加载更早消息用 scrollHeight 差值做
一次位置补偿；会话切换取消旧帧、清旧数据、落底部；宽度/方向变化：跟随时落
底一次，阅读时自然重排，不承诺像素位置；删除/展开/折叠后不跳顶不跳底，阅读
区域大致保持，不建事务/锚定泵/多阶段结算；用户意图优先。

历史消息默认普通 DOM + 现有分页，先验证 500 条纯文本消息性能；无可观察卡顿
不得引入虚拟列表。若 profile 明确证明不可接受：停止扩展、标记 READY_FOR_OWNER、
由 Owner 决定成熟虚拟列表依赖或服务端分页，禁止再手写变高虚拟列表。

## 7. 复杂度硬上限

1. pages/chat 非测试生产文件总量 ≤2,500 行。
2. chat.vue ≤1,600 行。
3. 聊天 scroll/follow/anchor 生产代码 ≤250 非空非注释行。
4. scroll handler 最多一个；待执行 rAF 最多一个；无循环 pump/递归帧调度/
   稳定相位/帧预算；无 setInterval；无滚动用途长 setTimeout。
5. 不创建通用滚动框架；不拆 helper 规避限制。
6. chat.spec.ts ≤2,200 行；Journey03 ≤800 行。
7. pages/app/design-system 生产总行数 ≤16,972（应下降）。
8. 新基础组件 ≥2 真实消费者；单页专用视图不包装成通用 Base*。

不满足时报告原因输出 PARTIAL，不继续造抽象。

## 8. 20 个路由的产品目标

1. **login/age/consent**（admission）：无底栏；当前步骤、原因、下一步明确；
   一个主动作；表单有可见 label/字段错误/恢复方式；不显示 role/内部 enum/
   原始 ISO 时间；Technical Alpha 工程说明不作首屏主体。
2. **index**：首屏回答"我现在可以做什么"；有关系→继续当前对话；无关系→创建
   陪伴；最近会话/待确认记忆/提醒轻量列表；禁止 Dashboard 卡片网格和多枚
   同权重 CTA。
3. **conversations**：正常移动端列表；标题/预览/本地时间可扫描；密文/空标题
   安全回退；新建会话清晰；改名/删除/无痕等低频动作进菜单或 Sheet；危险区
   不占主屏大块面积。
4. **chat**：简洁顶栏（返回/陪伴名/AI 非真人/更多菜单）+ 消息历史（唯一滚动区）
   + 底部输入区（textarea、发送/取消、轻量附件操作）。低频功能进更多菜单/
   Sheet；异常/连续使用/导入提示为可关闭上下文提示；消息反馈为消息级操作。
   首屏不得堆叠服务状态卡/关系卡/会话卡/用量卡/反馈卡/模式卡/多排 chip/输入栏。
5. **memory/memory-detail**：用户语言组织（待确认/已确认）；说明记住了什么、
   来源、用户能做什么；确认/编辑/拒绝/删除有明确反馈；不直出 RELATIONSHIP/
   PENDING_CONFIRMATION/内部 ID；空态错误态有下一步。
6. **account**：不做账号编号+USER 角色首屏；按陪伴/提醒与休息/隐私与 AI/数据/
   帮助/账号与安全分组；每行一个任务；注销、退出等危险操作单独放底部。
7. **companion/reminder/health/incognito**：每页一个任务；长表单分组渐进披露；
   保存有 loading/success/error；提醒明确"当前不会主动推送"；无痕明确生效
   范围和时点。
8. **data/export**：消费者能理解的数据分类；不显示原始 role/enum/provider/
   opaque ID；导出保留二次认证、异步、一次性下载；错误有恢复方式。
9. **help/report/ai-notice**：帮助可扫描；举报保留 messageId 上下文但不展示
   内部 ID 主体；AI 说明平实不营销；成功/重复/失败有反馈。
10. **ops/admin**：独立 Internal Shell；可更高密度但可读可访问；普通用户不可见；
    消费者底栏不出现；敏感内容默认脱敏；窄屏列表转分组行不横撑。

## 9. 测试纠偏

可删除或重写与已移除实现绑定的测试；不得删除用户行为覆盖。禁止：skip/only/
todo、catch 后重复用户动作变绿、End 连按四次、force click、固定 waitForTimeout、
data-preserve-* 成功 oracle、phase/generation/pump 验收、page.evaluate 改
scrollTop 冒充手势、route.fulfill 注入后声称真实后端、加账号/等待 TTL 冒充
修复租约、截图先于断言、放宽安全/权限/数据权利断言。

真实链路与合成链路明确分开。最小聊天 E2E：真实发送 smoke（真实 POST/SSE、
服务端 messageId）；滚动与历史（375×812 与 812×375、真实滚离、End/按钮恢复、
history 唯一滚动区）；操作与边界（菜单/改名/删除确认/删除单飞/取消/失败重试/
会话切换/条件提示，普通可操作 click）。产品级断言：真实可见非零尺寸、无重叠、
消息文本可见交集、滚离不被拉回、删除/加载后停留相近区域；不要求 4px、不查
内部事务状态。

## 10. 执行阶段

- **Phase 0**：冻结事实、建分支、基线 check.sh、本计划、旧计划标记
  superseded、Keep/Replace/Remove 矩阵。不写视觉代码。
- **Phase 1**：实际启动 H5 查看现状作反例；替换 DESIGN.md/design.json/视觉
  契约；轻量语义 token；先做首页/对话列表/聊天/我的四代表页；390/375/横屏
  检查；一次批量修正。
- **Phase 2**：聊天去复杂度重写（删除虚拟 spacer/测高表/PreserveTransaction/
  follow pump/echo 协议，采用第 6 节方案）；保留 SSE/防串写/删除单飞/用户
  可见功能；重写实现耦合测试；只跑针对性测试。
- **Phase 3**：按 admission → memory → companion/reminder/health/incognito →
  data/export → help/report/ai-notice → ops/admin 顺序迁移；每组只跑直接
  相关测试。
- **Phase 4**：逐页检查 loading/empty/error+retry/success/disabled/permission
  denied/长中文/长 token/安全时间/危险确认/reduced motion/键盘焦点/375px
  overflow；消费者模板有界检索 enum/ISO Z/内部 ID/enc1:enc2:/provider 原值/
  工程文案。
- **Phase 5**：临时完整矩阵（20 路由×390，Shell 代表×5 视口）→ canonical
  证据最多 12 张入 `frontend/.impeccable/review/correction-final/`；截图来自
  最终候选、硬断言后生成、完整 viewport、人工逐张检查；视觉修复最多一批，
  确认最多一轮。

## 11. 最终验证（稳定候选一次）

1. `bash scripts/check.sh`
2. `pnpm --dir frontend build:h5`
3. 冷隔离栈 `pnpm --dir frontend test:e2e`
4. Impeccable detector 对全部改动 UI 文件一次
5. `git diff --check db8815e4..HEAD`
6. `git status --short`
7. 人工检查 canonical 截图
8. 检查生产构建中旧视觉 seed 和旧滚动诊断标识不存在

失败时修复直接根因、只重跑受影响检查；输入未变化不重跑全套。

## 12. 提交纪律

阶段提交：plan+superseded → 视觉基础+shells → chat 简化 → 消费者路由 →
internal 路由 → 测试+清理 →（如需）最终文档。禁止 diag-only/roundN/临时截图
脚本/probe 日志/测试凭据/真实对话/失败截图/中间生成物/临时端口/被放弃方案
提交；不为凑数量机械拆分。

## 13. 可跳过项与硬阻塞

可 SKIP / READY_FOR_OWNER：VoiceOver/TalkBack 真机、iOS/Android 真机、LAN
外部设备、7 天 dogfood、正式品牌名/Logo、后端 SSE lease 滞留（第四条流 429）、
真实 Provider 外部条件。最终单列 `READY_FOR_OWNER: runtime SSE lease lifecycle`。

必须 PARTIAL：无法建干净分支、重叠未知改动、H5 build 失败、本任务测试回归、
auth/admission 回归、权限回归、SSE 正式内容重复或丢失、memory/data/export
权利回归、消费者泄露敏感值、20 路由缺失、聊天旧状态机仍存在或换名迁移、
视觉明显不符合普通移动端习惯。同一条件失败两次不得无界重试。

最终状态只能是 `READY_FOR_CODEX_SIMPLIFICATION_AUDIT` 或
`PARTIAL_FRONTEND_CORRECTION`；不自行宣告 COMPLETE。

## 14. Keep / Replace / Remove 文件矩阵

| 文件/模块 | 处置 | 说明 |
|---|---|---|
| `api/realtime.ts`、`realtime-transport.ts`、`sse-parser.ts`、`stream-reducer.ts`、`stream-recovery.ts` | Keep 只读 | SSE 协议编排与恢复语义，第 4.5 条保留项 |
| `api/chat.ts`、`auth.ts`、`memory.ts`、`relationship.ts` 等 api/** | Keep 只读 | 契约层；除直接可复现缺陷不改 |
| `stores/chat.ts`、`auth.ts`、`relationship.ts` 等 stores/** | Keep 只读 | 含 historyWindowToken 防串写、删除单飞支撑 |
| `domain/nav-guard.ts`、`next-step.ts`、`context-href.ts`、`conversation-display.ts`、`companion-presentation.ts`、`persona.ts`、`request-id.ts` | Keep | 权限/准入/安全展示 helper |
| `domain/safe-markdown.ts` | Keep | 白名单渲染 |
| `domain/generation-restore.ts` | Keep | S0-20 恢复（store 依赖） |
| `domain/virtual-list-window.ts`、`display-throttle.ts` | Remove | 手写虚拟窗口与草稿节流为被删机制；chat 重写后无消费者则删文件 |
| `pages/chat/chat.vue` | Replace 重写 | ≤1,600 行；flex 滚动方案；删除全部 preserve/follow/echo 机制 |
| `pages/chat/ChatContextHead.vue` | Replace 重写 | 条件提示收为可关闭上下文提示 |
| `pages/chat/chat.spec.ts` | Replace 重写 | ≤2,200 行；删除实现耦合断言 |
| `e2e/journeys/03-relationship-chat.spec.ts` | Replace 重写 | ≤800 行；真实/合成链路分清 |
| `app/navigation.ts`、`nav-guard.ts` | Keep | 20 路由/权限真源 |
| `app/ConsumerShell.vue`、`InternalShell.vue`、`BottomNav.vue`、`PageHeader.vue` | Replace 重写 | 浅色轻量 shell |
| `app/navigate.ts` | Keep | 导航工具 |
| `design-system/base.css`、`AppIcon.vue`、`AppSheet.vue`、`EmptyState.vue`、`ErrorNotice.vue`、`RetryButton.vue` | Replace 重写 | 浅色 token；组件按真实消费者保留 |
| `components/RelationshipSelector.vue` | Replace 重写 | 保留行为、换视觉 |
| `pages/index/index.vue` | Replace 重写 | 关系首页，唯一主动作 |
| `pages/conversations/conversations.vue` | Replace 重写 | 正常移动端列表 |
| `pages/memory/memory.vue`、`memory-detail` | Replace 重写 | 用户语言分组 |
| `pages/account/account.vue` | Replace 重写 | 分组导航枢纽 |
| `pages/login/login.vue`、`age/age.vue`、`consent/consent.vue` | Replace 重写 | 线性准入 |
| `pages/companion/companion.vue`、`reminder`、`health`、`incognito` | Replace 重写 | 一页一任务 |
| `pages/data/data.vue`、`export/export.vue` | Replace 重写 | 消费者语言 |
| `pages/help/help.vue`、`report`、`ai-notice` | Replace 重写 | 可扫描/平实 |
| `pages/ops/ops.vue`、`admin/admin.vue` | Replace 重写 | Internal Shell 高密度 |
| `frontend/DESIGN.md`、`.impeccable/design.json` | Replace | 浅色新方向 |
| `frontend/index.html` body 注释 | Replace | 删旧视觉契约（THESIS/seed 等） |
| `pages.json` globalStyle 深色值 | Replace | 浅色 |

## 15. 复杂度基线（对比用）

- chat.vue：4,413 行 → 目标 ≤1,600
- chat.spec.ts：4,441 行 → 目标 ≤2,200
- Journey03：2,507 行 → 目标 ≤800
- pages/app/design-system 生产总量：16,972 行 → ≤16,972（应显著下降）
- pages/chat 非测试生产文件：4,413 + ChatContextHead 193 → 目标 ≤2,500
