# 前端产品化重构长线执行方案（zcode / GLM-5.3）

> **SUPERSEDED（2026-08-29）**：本计划已被纠偏式重构计划取代——
> `docs/planning/2026-08-29-frontend-simplification-redesign.md`。
> 本文件仅作历史追溯。其视觉方向（The Lit Window）、seed `d2f84655`、
> Round 1–11 的逐像素锚定目标、≤4px 精度要求与帧级状态机证明均不再具有
> 实施约束力；旧视觉方向按新计划作为反例处理，不再是视觉真源。

## 1. 任务定义

### 单一目标

在不改变后端、OpenAPI、Catalog、安全边界和现有数据语义的前提下，把当前 20 页的
Technical Alpha H5 从“功能/运维入口集合”重构为一个移动优先、主旅程明确、可理解且
视觉一致的虚拟陪伴产品，并保留所有当前已实现能力、深链、恢复、安全和数据权利行为。

执行者是 zcode / GLM-5.3，且是本任务唯一前端写入 owner；Codex 负责任务方案和完成后的
独立审计。此文档是本次明确请求的唯一长线计划，不另建任务卡、Evidence、Handoff、评分表
或第二套检查流程。跨上下文恢复只依赖本文件、Git 状态、阶段提交和机器真源。

### 基线

- 规划基线分支：`main`；执行必须在独立分支 `codex/frontend-product-reconstruction` 完成，
  禁止在审计前 push 或 merge 回 `main`。
- 规划时 HEAD：`c52fbae38238ed5fab18f99ba2045e71a45b3282`
- 规划时工作树除本方案与 `PRODUCT.md` 外原本干净。
- `bash scripts/check.sh`：2026-08-26 PASS，Catalog、OpenAPI、许可证、前端测试和类型检查
  全部通过（22 秒）。
- 前端：uni-app + Vue 3 + TypeScript + Pinia，20 个页面，约 12,174 行 Vue 页面/组件代码；
  共享组件只有 4 个，未形成 App Shell、统一导航或被页面实际消费的语义 token。

### 完成定义

只有同时满足以下条件才可报告 `READY_FOR_CODEX_AUDIT`；`COMPLETE` 只由 Codex 审计通过后给出：

1. 登录后的普通用户只面对清晰的四入口产品壳：**首页、对话、记忆、我的**；每页只有一个
   明确主任务，Admin/Ops 不出现在普通导航中。
2. 当前 20 个路由及其已实现行为均有明确归属；允许折叠、分组和重排入口，不允许悄悄删掉
   功能、深链、状态或数据权利。
3. 登录/准入/首次关系/聊天/realtime 恢复/记忆/导出等现有关键契约保持成立。
4. 375px、390px、横屏、平板和桌面不出现横向溢出、控件竖排、固定栏遮挡或无法触达的操作。
5. 新视觉系统有单一语义 token 与组件来源；页面不再各自复制导航、卡片、按钮、错误和空态。
6. 可访问性、状态真实性、安全与隐私红线满足本文验收门槛。
7. 最终构建、日常检查和既有完整 E2E 有如实结果；zcode 留下可供 Codex 独立审计的截图和
   最终报告。

“遇到问题跳过”只表示把受阻项保持未实现并在最终报告中列出，不表示禁用测试、吞退出码、
伪造成功或把失败候选交付为完成。

## 2. 产品边界与默认决策

执行前必须读取：

- `AGENTS.md`
- `PRODUCT.md`
- `README.md`
- `TODO.md` 的 `DOGFOOD-*` 当前执行段
- `docs/decisions/0006-owner-only-local-dogfood-boundary.md`
- `specs/catalog/product-scope.yaml`
- `frontend/src/pages.json`
- `frontend/src/domain/nav-guard.ts`
- `frontend/src/domain/next-step.ts`
- `frontend/src/domain/context-href.ts`
- `frontend/playwright.config.ts`
- 本文件

`PRODUCT.md` 当前是基于机器真源建立的**暂定产品上下文**，不是 D0 或真实用户确认结论。执行者可据此
完成本轮 Owner-only 重构，但不得把其中的用户假设升级为已验证事实；Owner 回来后的确认或更正优先。

事实优先级继续按仓库规则：AGENTS → Catalog/OpenAPI/contract → migration/RLS → 当前代码和
测试 → README/TODO；`docs/source/v0.4` 只提供目标结构参考，不能覆盖机器真源。

### 用户与场景

- 当前唯一真实使用者是 Owner 单账号，在本机同源环境通过 iPhone Safari 和 Android Chrome
  使用简体中文 H5。
- 待验证目标人群是 25–35 岁、晚间需要低压力倾听的职场成年人。
- 核心价值是低压力倾听和可信、用户可控的关系记忆，不是展示功能数量。

### 不能包装成可用的能力

- 不做公开注册、真实支付、套餐营销、恋爱/成人模式、语音、图片、文件、Web 搜索、工具调用、
  WebSocket、远端部署或真实用户 Beta。
- Alpha 提醒只存储和展示，不得设计成真实推送。
- 紧急联系人保持隐藏，不得声称已通知任何人。
- 成年状态必须来自服务端，不得用客户端勾选替代。
- 不在 UI 写死 Provider、模型 revision、额度、费用、处理地区、保留期或训练使用。
- 不编造用户评价、合作方、效果数据、人工工单 SLA、商业声明或已不存在的资产。

### 无人值守默认规则

- 用户未回答审美或细节问题时，按本文默认方向继续，不等待回复。
- 缺正式品牌资产时使用代码原生排版、形状和 SVG；不新增生产依赖，不用 emoji 充当结构图标。
- 需要新增生产依赖、修改后端/契约、读取真实对话或真实账号数据时，跳过该项并报告；不要扩大
  授权范围。
- 外部 Provider、Owner 真机、VoiceOver/TalkBack、证书、LAN 或真实条款不可用时标记
  `READY_FOR_OWNER` / `SKIP`，继续完成可在合成环境验证的部分。
- 同一条件连续失败两次后停止该项，记录命令、错误、影响和已尝试的最小恢复动作；不得无界重试。
- 若当前阶段引入测试失败，必须修复或只撤回自己在该阶段的改动后再继续，不能把新回归当作可跳过
  项。

### 可跳过项与硬阻塞

- **可跳过并继续**：审美细节、非必要插画/资产、外部 Provider、真机、LAN、证书、真实条款、
  VoiceOver/TalkBack 和 7 天体验。
- **必须停止依赖链并报告 `PARTIAL`**：无法建立隔离分支、出现重叠的用户/他人改动、基线失败无法
  解释、核心 App Shell 阶段失败、H5 build 失败、zcode 引入的测试回归，以及 auth/admission、权限、
  realtime、memory、export、安全、隐私或数据权利契约回归。
- 只有成功撤回当前阶段且后续阶段不依赖它时，才可继续其他独立工作；不得在基础壳失败后盲目迁移页面。

## 3. 目标信息架构

### 普通用户壳

| 顶层入口 | 用户问题 | 主动作 | 当前路由归属 |
|---|---|---|---|
| 首页 | “我现在可以做什么？” | 继续聊天 / 开始聊聊 | `index`，并展示最近会话、待确认记忆、近期提醒的摘要 |
| 对话 | “我之前聊了什么？” | 打开或新建会话 | `conversations`；`chat` 是沉浸式详情，不再承担全站导航 |
| 记忆 | “它记住了什么，为什么？” | 确认待处理记忆 | `memory`、`memory-detail` |
| 我的 | “如何调整关系、提醒、隐私和账号？” | 进入当前最相关设置 | `account` 作为分组入口，其余设置页作为二级页面 |

### 首次与阻断流程

登录、成年状态、必要同意和关系建立使用线性准入流程，不展示四入口底栏：

```text
登录 → 服务端 Admission Decision → 成年状态 → 必要同意 → 创建唯一陪伴关系 → 首页/首次聊天
```

保持 `next-step.ts` 和服务端状态为事实来源；UI 只解释当前原因和下一步，不自行推断“已通过”。

### 二级任务归属

- `companion`：我的 → 陪伴设置；长表单按“称呼与形象 / 对话偏好 / 记忆与提醒 / 危险操作”分步或分组。
- `reminder`：首页摘要 + 我的 → 提醒；明确“本地列表，不会主动推送”。
- `health`：我的 → 使用与休息。
- `incognito`：我的 → 隐私默认值；聊天新建会话继续提供会话级选项，并明确“创建时冻结”。
- `consent`、`age`、`ai-notice`：我的 → AI 与隐私。
- `data`、`export`：我的 → 我的数据；导出仍是二次认证、异步、一次性下载。
- `help`、`report`：我的 → 帮助与反馈；保留从消息上下文锚定举报。
- `account`：我的总入口，同时保留改密、会话管理、登出和两步注销。
- `ops`、`admin`：独立 Internal Shell，按角色守卫；普通用户看不到入口、内部文案或数据轮廓。

所有既有 hash 路由、`return`、`relationshipId`、`conversationId`、`memoryId`、`messageId`
和消息举报锚点保持兼容。

现有 `index/help/ai-notice/health` 的 public 访问分类保持兼容；把入口收进“我的”只改变发现路径，
不自动改变登录要求。四入口使用 Consumer Shell 的自定义 H5 底栏，不改成 `pages.json` 原生 tabBar，
以保留现有 query、深链、返回栈和 uni-app 导航守卫行为。

## 4. 暂定视觉与交互方向

这是本次无人值守任务的 **brief-pinned 方向**，不等同于正式品牌决策。用户已要求需要决策时先跳过，
因此本轮不再启动或等待 Impeccable 决策页；执行路径固定为 **code-led**，只约束本次会话，不写入
`.impeccable/config.json` 作为长期偏好。不要把 `ui-ux-pro-max` 的自动设计系统结果持久化成第二个
视觉真源。

### 方向：一盏仍亮着的窗（The Lit Window）

- **世界**：晚间公寓窗格与室内外光线层次。陪伴不是拟人头像或恋爱对象，而是在夜里保持可进入的
  一块安静空间。避免粉色恋爱、霓虹赛博、医疗健康模板、深蓝运维台和玻璃拟态卡片海。
- **首屏**：登录后首先看到当前陪伴关系和一块占主导的“继续聊聊”空间；最近会话、待确认记忆和
  提醒只作为与当前关系有关的窄摘要，不平铺功能按钮。
- **路径**：恢复会话 → 进入安静的聊天空间 → 需要时确认记忆 → 返回关系连续性；低频设置退到“我的”。
- **交互**：当前空间像亮灯一样清楚进入，其他层级安静退后；状态转换使用短、可中断的亮度/位移动效，
  内容默认可见，并完整支持 `prefers-reduced-motion`。
- **跨页面**：聊天让内容占主导；记忆强调来源、状态和用户控制；设置使用清晰分组；Internal Shell 使用
  同一 token 的中性高密度变体，不借用消费者首页布局。
- **诚实风险**：夜间隐喻容易变成低对比度装饰或另一套深色控制台；实现必须靠明确信息层级、可读文本、
  受控告警色和触摸可用性证明它是产品，不是主题皮肤。

规划阶段运行的 Impeccable seed 为 `d2f84655`，assigned index 为 6。候选方向中的可取纪律只作为
质量提升，不混搭其外观：

- 设计年鉴：把“来源、状态、更新时间”做成精确的版式注释，服务可信记忆。
- 夜航仪表：一个状态只表达一个事实，琥珀/红色只用于真实警告。
- 日光剖面：用时间与层级组织连续内容，而不是用更多卡片分割。
- 严格交通网格：导航位置、活动态和触摸尺寸保持稳定。
- 连续光路：发送、生成、恢复、完成之间保留可理解的因果连续性，但不用霓虹外观。
- 流体墨：动效可以有生命感，但永远不遮挡内容或承担正确性。

code-led 方向契约必须作为 `frontend/index.html` 的 `<body>` 首个子节点注释写入，并在首次 production
build 后从 `frontend/dist/**` 检索 seed `d2f84655`，确认编译未移除：

- **THESIS**：一盏仍亮着的窗承载当前关系，拒绝功能按钮网格和运维控制台首页。
- **OWN-WORLD**：暮色墨蓝环境、清晰明亮的活动内容面、克制的暖光强调、人文无衬线文字、稳定四入口网格；
  琥珀与红色只表达真实警告。
- **STORY**：用户回来先看见关系，继续一段对话，在需要时审阅记忆并保持关系连续。
- **FIRST VIEWPORT**：当前陪伴与“继续聊聊”占主导；最近会话、待确认记忆、提醒是窄摘要；主动作单一且
  在 375px 首屏可见。
- **FORM**：The Lit Window，规划候选第 6，seed `d2f84655`。
- **FINISH**：`unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance`

`ui-ux-pro-max` 在规划阶段两次 `--design-system` 查询均返回 Landing Page / 粉红恋爱 / Cyberpunk
等不适配建议，已明确拒绝。执行时仅使用其经过验证的聚焦规则：导航层级、移动优先、触摸目标、表单
反馈、错误恢复、对比度、焦点、减少动效和 Vue 实现细节；无匹配结果不得持久化。

## 5. 代码结构目标

保留 `api/`、`stores/`、`domain/` 的业务契约，优先重构 view 层。推荐边界：

```text
frontend/src/
  app/                  # ConsumerShell、InternalShell、生产导航模型、页面框架
  design-system/        # semantic tokens、基础 UI、图标、状态与表单组件
  features/             # 仅从热点页面提取的视图片段，不重写 API/store
  pages/                # 路由适配与页面组合
  api/ stores/ domain/  # 原契约边界，除明确 UI 缺陷外不重构
```

最少应形成：Consumer Shell、Internal Shell、Page Header、Bottom Navigation、Button、Icon、
Form Field、Section/List Row、Tabs/Segmented Control、Status Badge、Async State、Empty/Error State、
Danger Zone、Dialog/Action Sheet。组件不是为了凑目录；只提取至少两个真实消费者共享的模式，热点页面
私有视图片段可留在 feature 内。

设计 token 使用语义角色而非页面色值：surface、text、muted、primary、focus、border、success、warning、
danger、spacing、radius、type、motion、layer。迁移完成的页面不得继续新增 raw hex、随机圆角、随机阴影或
页面私有导航色。

生产导航模型必须由 Consumer/Internal Shell 真实消费，并覆盖全部 20 路由的当前 `PageClass`、角色权限、
允许的 query/深链参数、目标 IA 归属和主状态；对该模型写行为测试。它是运行时代码，不是额外治理清单。

不要新增图标依赖；使用一套代码原生 SVG 图标，线宽、尺寸、active/disabled 语义一致。图标旁已有可见
文字时对读屏隐藏；纯图标按钮必须有可访问名称和状态。

## 6. 按序执行阶段

### Phase 0：Fit-check 与行为冻结

1. 读取本方案列出的真源，检查当前 HEAD、工作树和已有并发修改，不覆盖不属于自己的改动。若目标分支
   不存在且 `main` 仍可解释地基于规划 HEAD，则从当前 `main` 创建
   `codex/frontend-product-reconstruction`；若已存在则只在确认是本任务分支后恢复。禁止 push/merge。
2. 运行一次基线 `bash scripts/check.sh`；若与本方案记录的绿色基线不同，先判定是否为外部变化。
3. 建立被 Shell 消费的生产导航模型。真正冻结的是路由/参数、权限、服务端状态语义、数据操作、恢复与
   idempotency、安全和数据权利；旧首页布局、旧导航 test ID、旧视觉文案可有意更新并同步改写测试。
   不删测试、不减少行为覆盖。
4. 明确首次关系兼容路径：准入流程引导到 `companion` 创建；直接进入空聊天仍提供“创建陪伴”入口并
   跳到同一流程。更新 E2E 路径，不删除首次关系能力。
5. 每个新的 zcode 执行会话先运行一次
   `node /Users/hxf/.codex/skills/impeccable/scripts/context.mjs --target frontend`，完整读取 Impeccable
   `SKILL.md` 与 `reference/new-work.md`；首次 UI 编辑前读取 `reference/craft-floor.md`。同时完整读取
   `ui-ux-pro-max/SKILL.md`，只做与当前阶段相关的聚焦查询。
6. 不在此阶段写视觉代码，不创建新的流程/审计文件。

停止条件：能够说明每个页面的用户任务、目标归属、关键状态和直接受影响测试。

### Phase 1：产品壳、导航和设计基础

1. 建立语义 token、全局排版、焦点、触摸、safe-area、层级和 reduced-motion 基础。
2. 建立 Consumer Shell 与四入口底部导航；深页使用统一返回、标题和上下文操作。
3. 建立独立 Internal Shell；短期可保留单路由内分区，不强制拆后台构建包。
4. 消除 uni-app 原生标题与页面标题重复；统一 `pages.json`、manifest 和用户可见标题。
5. 先把现有 Empty/Error/Retry/RelationshipSelector 纳入新组件系统，再增加确有消费者的组件。
6. 将旧的首页入口/`alpha-nav` 布局断言改写为新导航模型、四入口、角色隐藏、active 状态和返回/深链
   行为测试；布局 test ID 可替换，业务操作 test ID 尽量保持稳定。

验收：导航在 375px 无横向滚动，active 状态明确，键盘/返回/深链可用；普通用户看不到 Admin/Ops。

### Phase 2：首页、登录与准入

1. 把 `index` 从 17 个内部入口的边界台改成关系首页；唯一主动作是继续/开始聊天。
2. Runtime、版本、门禁明细和技术原始详情移入 Internal Shell；首页只保留用户需要理解的服务状态和
   下一步，不暴露内部 ID、Provider、Prompt 或规则码。
3. 登录页只突出登录；邀请注册保持当前开关和折叠能力，但不与登录争抢主层级。
4. 成年、同意、创建关系按 `next-step.ts` 形成线性准入体验；阻断原因和恢复路径清晰。
5. 修复当前 375px 登录页 `scrollWidth=440` 的真实横向溢出。
6. 空聊天的“创建陪伴”继续可达，但只跳转到统一创建流程，不在聊天页复制一套关系表单。

验收：匿名深链 → 登录 → 原路返回、临时密码跳转、准入阻断、登录错误焦点和现有测试 ID 全部成立。

### Phase 3：聊天与会话核心

1. `chat.vue` 只服务当前会话：消息阅读、输入、模式、发送/取消/恢复和少量上下文操作。
2. 把会话管理收进抽屉/Action Sheet 或 `conversations`；消息级低频操作收进明确的更多菜单，不再把
   复制、不记忆、删除、举报、重试、版本全部平铺。
3. 保留 SSE、idempotency、reload snapshot、draft、gap/epoch/terminal、虚拟列表、取消和不重复 POST。
4. 明确 AI 非真人、当前关系、无痕冻结状态、服务降级、发送/恢复终态；不把传输失败显示成生成失败。
5. 会话页区分活跃、历史/已结束与危险的全部删除；危险操作保留预览、二次确认和撤销/恢复说明。
6. 修复当前 375px “新建关系”按钮 59×184、文字逐字竖排的真实响应式缺陷。

验收：E2E 03、04、07 的行为语义不变；键盘、软键盘、滚动到底、长消息、长 token、横屏可用。

### Phase 4：可信记忆中心

1. 记忆首页优先“待确认”，再展示已保存；事件、过期、拒绝、删除、被替代记录进入清晰分组/筛选。
2. 移除普通用户 raw relationship ID 输入，改用受约束的当前关系/选择器；深链参数仍兼容。
3. 每条记忆明确摘要、作用域、来源、状态、自动保存、事件时间和修改/删除/替代路径。
4. 详情页保留 evidence、空来源、缺 ID、加载失败和替代链；不把历史状态当成普通有效记忆。

验收：只有 API 成功后才显示确认/删除成功；E2E 05 和 memory 组件测试保持通过。

### Phase 5：陪伴、提醒与“我的”

1. 把 `account` 重组为“我的”入口，但保留改密、登录会话、登出、调查和两步注销行为。
2. 陪伴设置按用户心智分组，危险的重置/删除与日常偏好分离；唯一 persona/companion 限制如实呈现。
3. 提醒拆分创建与列表，区分待处理/已完成；持续明示不会主动推送。
4. 区分无痕默认值与当前会话冻结值；使用健康不与模拟权益混成同一主信息。
5. 数据、导出、同意、成年、AI 说明、帮助、举报成为可理解的二级页面；复杂页使用渐进披露。
6. 导出、撤回同意、注销等高风险操作继续要求当前密码，下载 URL/token 不泄漏到错误状态或持久状态。

验收：所有原有入口仍可由上下文或“我的”到达；数据 partial/stale/error 不被渲染成空数组或成功。

### Phase 6：Internal Shell 与后台整理

1. `ops` 承载 Runtime/版本/服务模式/边界信息；没有权限时不渲染内部页面轮廓。
2. `admin` 至少按账户、Provider/用量、审计、安全/队列、邀请/权益、Ops Case 分区，并提供稳定内部导航。
3. 账户、Provider、审计、队列和内部备注的权限与脱敏逻辑保持不变；不要为了桌面表格破坏手机查看。
4. 后台使用更高信息密度，但继承相同可访问性、token、状态组件和错误恢复。

验收：普通 USER 无入口且守卫生效；ADMIN/Operator 现有测试通过；窄屏表格可换为摘要行/详情，而不是
不可读 nowrap 横向堆叠。

### Phase 7：全局 harden 与视觉收尾

1. 全页检查 loading、ready、partial、stale、empty、blocked、offline、error、success 和危险操作状态。
2. 统一文案：先说明发生了什么，再给下一步；Request ID 可复制但不抢主层级；内部错误码只在需要时展开。
3. 检查正文对比度 ≥4.5:1，非文本控件 ≥3:1；触摸目标按移动平台至少 44pt/48dp 等效范围并保留间距。
4. 检查 200% 缩放、长中文/英文 token、软键盘、safe-area、焦点不被 sticky 元素遮挡、颜色非唯一状态媒介。
5. 动效只用 transform/opacity 等稳定属性，内容默认可见，可中断，不依赖 animation end 保证正确性。
6. 清理迁移后不再使用的页面私有样式和重复组件，不顺手重构 API/store/domain。

遵循 Impeccable 的有界视觉 QA：一轮批量截图 → 一次批量修复 → 最多一次确认，停止开放式抛光。

### Phase 8：文档、验证与交付

1. 在最终稳定候选上运行一次 Impeccable detector；修复机械问题，不运行第二次 detector。
2. 完成 Impeccable finish review。若 zcode 环境没有独立 reviewer 能力，使用 Skill 的 degraded 流程并在
   报告中说明；该自检不替代 Codex 的最终独立审计。
3. 从最终实际实现生成/更新 `DESIGN.md`，不要在实现前写一份与代码脱节的规则书。
4. 运行本文第 8 节的验证矩阵。
5. 输出一个最终回复，不新增 handoff/evidence 文档。

最终回复必须包含 detector 结果、finish-reviewer 的 disposition、尚未解决的 material 项，以及 build
产物中 seed 检索结果。

## 7. 分支、提交与恢复策略

- 所有实现提交只进入 `codex/frontend-product-reconstruction`。zcode 不 push、不 merge、不直接修改
  `main`，最终只报告 branch base、tip 和 `READY_FOR_CODEX_AUDIT` / `PARTIAL`。
- 每个 Phase 完成并通过其直接受影响测试后做一个小步提交；热点文件 `index.vue`、`chat.vue`、
  `memory.vue`、`admin.vue` 始终只有 zcode 一个写入者。
- 不使用 `git reset --hard`、`git checkout --` 或覆盖式回滚；只回退自己当前阶段的明确改动。
- 不改写/压缩用户或其他 Agent 的提交，不清理无关文件。
- 上下文耗尽或工具中断时，从最近阶段提交恢复：读取本文件、`git status`、最近 10 条 log 和当前 diff，
  继续未完成阶段；不要重新从 Phase 0 全量盘点。
- 不为“看起来更整洁”重写 `api/`、`stores/`、`domain/`；只有直接受影响契约需要最小修改时才动。
- `.impeccable/review/` 只保留本机审计材料且当前不在 `.gitignore`；提交时显式 stage 目标源码，禁止
  `git add -A`，不得提交截图、决策页缓存或其他本地 Skill 状态。

## 8. 验证矩阵

阶段内只跑会改变下一步的定向测试；最终候选只跑一次全量入口。不得删测试、加 skip 或吞退出码。

| 检查 | 时点 | 要求 |
|---|---|---|
| 直接页面/组件 Vitest | 每个 Phase 稳定候选 | PASS；失败先修复或撤回本阶段改动 |
| `bash scripts/check.sh` | 最终候选一次 | PASS；这是唯一日常全量入口 |
| `pnpm --dir frontend build:h5` | 最终候选一次 | PASS |
| `pnpm --dir frontend test:e2e` | 最终候选一次 | 本次无人值守长任务明确允许运行既有完整 E2E；使用合成隔离栈，不用真实 Provider/数据 |
| Impeccable detector | 最终视觉候选一次 | 记录并处理结果，不重复运行 |
| 真机 VoiceOver/TalkBack、LAN、证书、7 天体验 | 不由 zcode 执行 | `SKIP / READY_FOR_OWNER`，不得阻塞其他完成项 |

视觉回归截图保存在本机 `.impeccable/review/`，不要提交真实数据或凭据。全部 20 个路由必须各有至少
一张 390×844 的有效合成态截图，并在最终回复提供“路由 → 截图 → 状态/角色”映射。热点页再覆盖：

- 390×844：首页、聊天、会话、记忆、我的、Admin；
- 375×812：首页、登录、聊天和一个典型错误态；
- 812×375：首页、聊天；
- 768×1024：首页、聊天、Admin；
- 1440×900：首页、聊天、Admin。

截图必须使用合成账号/内容，等待入口动效稳定，从文档顶部捕获，并逐张打开确认不是空白、半加载或错误
页面。任一 375px 页面都应满足 `scrollWidth <= innerWidth`。

## 9. zcode 最终回复格式

最终回复必须先给实际结果，状态只能是 `READY_FOR_CODEX_AUDIT` 或 `PARTIAL`，再提供以下内容：

1. **交付摘要**：完成了哪些产品级变化，不按文件数量邀功。
2. **阶段与提交**：Phase → commit hash → 直接验证。
3. **验证表**：每条命令明确 `PASS / FAIL / SKIP / NOT_RUN`；不得把未运行写成通过。
4. **路由归属**：20 个现有路由在新 IA 中的位置，确认没有静默丢失能力。
5. **截图路径**：20 路由的“路由 → 绝对路径 → 合成状态/角色”映射，以及热点多断点截图。
6. **待 Owner 处理项**：编号、问题、为何跳过、当前安全默认、Owner 需要决定或执行什么。
7. **设计验证**：direction contract、build seed 检索、detector 结果、finish-reviewer disposition 与
   未解决项。
8. **已知限制**：仍存在的 material 问题及影响；有未解决核心回归时状态只能是 `PARTIAL`。

## 10. Codex 最终审计门槛

zcode 完成后，Codex 只做独立检查和结论，不默认替执行者修复。审计包括：

1. 对照本计划、`PRODUCT.md`、Catalog/OpenAPI 和 `base..tip` diff，确认未扩大产品授权或改坏契约。
2. 审查四入口 IA、主旅程、普通/Internal 隔离和全部路由归属。
3. 复核运行时页面与截图，重点看 375px、登录、聊天、错误/恢复、记忆、危险操作和 Admin。
4. 检查语义 token、共享组件、热点页拆分是否降低重复而未重写业务层。
5. 在最终稳定候选上独立运行最小必要验证；不重复执行已无变化的长检查。
6. 给出 `ACCEPT`、`ACCEPT_WITH_FOLLOWUPS` 或 `REJECT`，并列出可复现证据。只有 `ACCEPT` 或
   `ACCEPT_WITH_FOLLOWUPS` 才允许后续人工合并；Codex 不自动 merge。存在功能回归、安全/隐私
   越界、普通导航仍像功能目录、375px 仍溢出、核心状态伪造或必要检查失败时必须 `REJECT`。

当前环境没有 zcode CLI、connector 或完成事件编排器，因此无法在本线程自动派发或在睡眠期间自动触发
Codex 审计。用户需在 zcode 中启动第 11 节指令，并在其返回后让 Codex 执行本节审计。

## 11. 可直接交给 zcode 的启动指令

```text
你是 /Users/hxf/projects/virtual-companion 本次前端产品化重构的唯一写入 owner。
请完整读取 AGENTS.md、PRODUCT.md 和
docs/planning/2026-08-26-frontend-product-reconstruction.md，然后从 Phase 0 开始持续执行，
不要停在分析、方案或单个样板页。模型使用 GLM-5.3。所有实现只进入
codex/frontend-product-reconstruction；不要 push、merge 或直接提交到 main。

按计划逐阶段实现并小步提交，保护现有路由/深链、auth/admission、realtime、relationship、
memory、export 和测试语义。使用 impeccable 与 ui-ux-pro-max；本轮视觉方向已由 brief 固定为
The Lit Window 且 code-led，不启动或等待决策页。需要 Owner 决策、外部 Provider、真机、证书、真实数据、
新增生产依赖或后端/契约改动的事项跳过并记录，不阻塞其他阶段；但你引入的测试失败必须修复或
撤回该阶段改动，不能跳过。

最终完成全部可执行重构、一次日常全量检查、H5 build、既有完整 E2E、视觉截图和 Skill 要求的
finish review/DESIGN.md，再按计划第 9 节一次性回复。不要创建第二套任务、Evidence 或 Handoff
文件，不要自动进入未授权的 Beta、部署、支付或真实用户范围。最终状态只能是
READY_FOR_CODEX_AUDIT 或 PARTIAL，不能自行宣告 COMPLETE。
```
