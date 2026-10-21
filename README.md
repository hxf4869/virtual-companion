# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前后端运行时为 Go 1.26.7
`companiond`，前端为 uni-app + Vue 3 + TypeScript，数据层为 PostgreSQL 18 +
pgvector。Generation、Realtime、Memory、数据权利与管理员模型配置已接入 Go
runtime；项目尚未达到真实用户或公开生产发布条件。

## 当前状态（2026-10-21）

当前工作分支 `codex/audit-remediation`。2026-09-06 基线 `02c1fe91` 之后已
落地并推送的返修提交（验证证据见各提交与对账记录）：

- `d77e77c6` 登录验证码限流按 challenge 维度隔离，独立挑战不再互相挤占额度
  （httpapi 测试通过）；
- `aa6b14c2` 输入法回车误发送守卫（Enter/229 composition）、流式会话导航
  等待态与页面 owner 收口（587 项前端测试与 type-check 通过；320x568、
  390x844、430x932 三视口实测无横向滚动，早期 `*-390.png` 为 1200x823
  桌面窗口截图，不构成移动端证据）；
- `480a2c79` 验证码失效与错码区分、失效挑战三路径统一引导重新登录，TOTP
  合成 cipher 夹具独立初始化（594 项前端测试与 type-check 通过；
  `bash scripts/check.sh` 14s PASS；隔离 PostgreSQL 下 6 项
  TestTOTP|TestAuthChallenge 全部 PASS，含 setup 共 74.312s）；
- `04f2d0cf`（VC-R05，backend）数据导出失败单事务闭环，陈旧 claim 不击落
  导出并解除申请阻塞（已推送，验证细节见该提交）；
- `47f9590a`（VC-R06，backend）导出 worker 中断后过期 claim 终态恢复，
  解除 PENDING 申请重复阻塞（V135 恢复函数 + DATA_EXPORT 恢复块；单测、
  TestExportLeaseRecovery 与隔离 PostgreSQL RLS 测试 PASS，已推送）。

2026-10-21 聊天会话归属与恢复收口（VC-R04）：复现并修复 H5 同页 hash 深链/
参数变更下「URL 已切会话、页面仍显示旧会话流」（VC-R02 观察形态）；hash
编辑转等待后浏览器返回原会话不再卡在等待态（去重基准改为最近 init 目标）；
uni H5 经 KeepAlive 缓存离场页面，被停用的隐藏缓存页不再响应别的页面的
hash 变化（活动实例约束；getCurrentPages 实测缓存栈内隐藏实例会对一次
hashchange 双重 initPage，修复后收敛为单实例响应）；恢复核对增加会话归属
约束（等待页不核对、不接管，与监听注册顺序无关）与 turn 身份单飞；会话
窗口切换在途时作废旧 run 终局。607 项前端测试与 type-check 通过。真机
中文 IME 验证另立 `DOGFOOD-11`（见 [`TODO.md`](TODO.md)）。

2026-10-21 数据副本前端（VC-R07）：My 账号分组内联「聊天与记忆副本」面板，
当前密码申请、PENDING 手动查进度、READY 一次性下载、失败/过期可重申；三
KEEP 导出 API 接入既有 auth transport，下载走 `createAuthedFetch` 原始
`blob()`，超过 JS 安全整数的消息编号保真；成功消费清一次性 URL 后主动作
回到重新申请；账号切换重建面板清副本、必须改密的会话不出现入口。Catalog
snapshot 随 API scope 更新重新生成（`scripts/check.sh` 13s PASS）；全前端
641 项测试与 type-check 通过，终稿文案后 panel/account 定向 35/35 复核；
本机浏览器 390x844 实测申请/进度/下载事件齐全，下载 JSON 与预期原始字节
一致；320x568 表单几何截图无横溢。真实手机系统浏览器上完成副本下载与
保存未验收，仍为 Owner 人工项（见 [`TODO.md`](TODO.md)）。

2026-10-21 会话身份代次收口（VC-R08～R10，已推送）：身份提交推进恢复代次
并收口迟到 probe 的错误回填（`7cd0b772`）；换号身份交接清共享私有缓存并
作废在途 relationship/chat 列表读取（`07738d7d`）；旧请求的 401 不得退出
新登录——transport/authedFetch 按会话代次门控 onUnauthorized（`d2737bb9`）。

2026-10-21 缓存页面换号收口（VC-R11）：首页/全部会话/我的三个 KeepAlive
缓存页在身份交接时清空旧账号本地内容（会话预览、密码/注销表单输入、设备
列表、错误与忙态），页面私有的列表读取与动作失败 UI 回调按代次丢弃旧账号
迟到结果（成功/失败/finally均不回填、不解除新账号忙态；不含认证写成功返回
的排序），重新激活按账号归属加载新内容，隐藏页清理不
抢发请求；同账号重新认证不把在途加载判死（定向审计修复，含改密/删号迟到
失败文案不回填）。682 项前端测试与 type-check 通过；本机浏览器 390x844
合成 mock 实测缓存返回链（HomeA→全部会话A→ChatA→底栏My→登出→登录B→
浏览器返回 My/列表/Home）全程无旧账号内容，受控延迟的旧设备读取释放后不
回填。认证写成功返回的排序不在其范围：当时仍为源码候选（普通登出一项
已由 VC-R12 收口）；真机浏览器上的换号验证仍为 Owner 人工项。

2026-10-21 普通登出迟到不破坏新登录（VC-R12）：普通 logout 的服务端契约收口
为撤销当前 session，响应不再携带任何 Set-Cookie——按名+路径寻址的过期 Cookie
无法区分新旧值，迟到的登出响应会把较新登录刚装好的 vc_session/vc_csrf 从
浏览器一并删除；以 Go httptest 真实 HTTP+标准 cookiejar 加响应闸门先复现该
竞态（红：延迟 logout 后新登录 GET /auth/session 401），修复后同一断言转绿，
旧 token 服务端确已撤销（401）；正常登出、撤销失败不清 Cookie、90 天
trusted-device 保留语义不变，「logout 响应 0 条 Set-Cookie」为回归护栏。前端
store.logout 以身份归属代次（credentialEpoch）门控本地 clear 并返回归属布尔：
只有已提交新凭据（ACTIVE 登录/挑战完成，含同 ID 重登）或不同账号交接才推进
该代次——登出挂起期间一次失败登录（仅意图）或同会话 probe 读回 ACTIVE（仅
读取）都不算新凭据，旧登出仍正常本地退出（两项定向审计修正均有先红后绿的
回归测试锁定）；account 与 AdminConsoleShell 两个直接消费者页面仅在「归属
本次调用且此刻无较新已认证身份」时导航回登录页。OpenAPI/catalog 契约文案
与 dist、snapshot 同步再生成。689 项前端测试与 type-check、httpapi 定向 4/4
与整包、`scripts/check.sh` 14s PASS（本轮无浏览器端到端：Cookie 证明走真实 Go
httptest，合成 mock 不冒充真实服务，页面行为由组件测试覆盖）。遗留候选未
声称解决：revoke-session 自撤销/revoke-all/改密响应的同类 Set-Cookie 竞态、
logout 请求晚于新登录发出时服务端会撤销新会话的请求侧排序；真机浏览器验证
仍为 Owner 人工项。

2026-10-21 陪伴设置页账号归属（VC-R13）：陪伴设置页补齐与 R11 同型的身份
交接收口——watch auth.accountId 仅「已知账号→不同/退出」时清本地（草稿/
关系/状态机，不发请求），页面私有 load/save 代次独立作废旧账号迟到回调
（成功/失败/finally 不回填、不解除新账号忙态），KeepAlive 重新激活按内容
归属账号重载、同账号返回不重复请求；未保存草稿、保存中继续编辑、服务端
回读基线、超时 unknown 语义保持。696 项前端测试与 type-check 通过
（最终范围较 R12 +7：换号清理/激活重载/迟到回调/同账号返回/首触去重与
锁定空态起点的换号用例，换号全走真实 AuthStore login/clear）。浏览器
390x844 合成 mock 实测唯一真实存活链（空态→去聊天 navigateTo 压栈隐藏，
陪伴设置实例为父→chat 401 redirectTo login→登录 B→浏览器回退）：同一 Vue
实例（$vm.$.uid 不变）复活后显示 B 表单（沈屿）无 A 残留，同账号返回
零新请求、表单保留；原始实证为空态返回重载，正常 headerBack/重进/hash
回祖先/hash 到非祖先 index 及 historyBack（VC-R13P 只读核验，$vm.$.uid
级）均为全新实例，不宣称常规返回缓存。记忆页经同套核验无可达存活路径
（无产品压栈出口，六类路径均移除旧实例），本轮 NOT_REPRODUCED：模拟
生命周期的防护与测试不提交，两文件保持基线；迟到读/保存的覆盖以组件
测试为界。真机浏览器换号验证仍为 Owner 人工项。

2026-10-21 二级页直接入口返回闭环（VC-R14）：安装版 uni-h5 的
navigateBack 在页面栈仅剩当前页时把 delta 钳成 0 并 history.go(0) 原地
整页重载（不进 fail、无任何报错；浏览器 history.length 与 app 页面栈
无关），直接打开 /#/pages/companion/companion 或 /#/pages/memory/memory
时 [data-testid=page-back] 因此失效。navigate.ts 的 goBack 现于页面栈
可得且长 ≤1 时改走所属 tab 根回退（只读 uni-h5 实际提供的全局
getCurrentPages，缺席时保持原 navigateBack 委托）。浏览器 390x844 合成 mock
实测（session vcr14，/api/v1 全拦截 fail-closed）：直接入口点击返回先
RED（原地整页重载、栈 1 不动、零报错），修复后 companion/memory 均回
「我的」（SPA 替换无重载）；正常 我的→陪伴设置 栈 2 返回与 chat
（redirectTo 进入栈 1、返回回退首页）不回归。699 项前端测试与
type-check 通过。真机浏览器验证仍为 Owner 人工项。

2026-10-21 改密迟到成功不破坏较新登录（VC-R15）：「我的」改密的服务端契约
（ChangePasswordHash 原子撤销该账号全部 opaque session 与 trusted device）不变，
成功响应不再携带任何 Set-Cookie——按名+路径寻址的过期 Cookie 无法区分新旧值，
迟到的改密 200 会把较新登录刚装好的 vc_session/vc_csrf/vc_trusted_device 从
浏览器一并删除。Go httptest 真实 HTTP+标准 cookiejar 加响应闸门先复现（红：
改密服务端撤销完成后 B 同 jar 新登录，放行旧 200，B GET /auth/session 401、
新 vc_trusted_device 被删），修复后同断言转绿；旧 token 显式重放 401、旧密码
404、旧可信设备显式重放回 TOTP、新密码重登成功的撤销语义正向用例保持。前端
account.onChangePassword 成功路径按身份归属代次（credentialEpoch，store 新增
只读 getCredentialEpoch 出口，推进规则不变）让位：迟到成功遇较新登录（含同 ID
重登）不清新身份、不回登录页；失败登录意图与同会话 probe 读回不让位，正常
改密退出保留（4 项回归覆盖较新登录让位与正常退出对照——两项让位用例基线红，
两项对照用例锚定不误让位——定向 66/66 通过）。浏览器 390x844 合成 mock
实测（session vcr15，/api/v1 fail-closed、外部请求零发出）：A 改密挂起→底栏
tab-chats→受保护读取 401→真实登录 UI 完成 B ACTIVE→释放 A 旧成功（真实 200
送达、无 requestfailed），修复前 B 被清+拽回登录页（红），修复后停留 B 页面、
底栏保持、无登录表单（绿）。OpenAPI 契约文案与 dist/snapshot 同步再生成；
前端测试与 type-check 经 scripts/check.sh 14s 全 PASS。真机浏览器验证仍为
Owner 人工项。

项目仍未达到公开生产可发布条件；provider 条款/revision/费用外发、真实用户
Beta 前置、真机 IME 与无障碍等 Owner 人工项仍开放，见 [`TODO.md`](TODO.md)。
CI 远端运行 NOT_RUN（CI 仅由 `main` 触发；工作分支已推送但不触发 CI）。
新版产品范围以 `PRODUCT.md` 与 `frontend/DESIGN.md` 为准。

## 2026-09-06 修复轮状态（历史快照）

当时基线 HEAD `02c1fe91367b015443ec059264fd4d5273691ca0`，授权批次 N-00～N-08
（对应评审发现 F-01～F-08），逐项完成情况以后续提交与对账记录为准，不按提交
名回溯勾选。验证以本地入口为准：`bash scripts/check.sh`、`infra/db/` 隔离
脚本、定向 Vitest。历史文档中的 Owner-only 描述是时序差异，不代表新版产品
范围。

## 快速开始

```bash
# 日常检查：契约/生成物、Go 单测、前端测试与类型检查
bash scripts/check.sh

# 启动真实本地栈
cp ops/deploy/.env.example ops/deploy/.env.local
# 填写 ops/deploy/.env.local，真实 Secret 不入库
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
cd ops/deploy
docker compose --env-file .env.local up -d --build
```

部署、证书与验证步骤见 [`ops/deploy/README.md`](ops/deploy/README.md)，
Owner-only 联调见 [`ops/deploy/DOGFOOD.md`](ops/deploy/DOGFOOD.md)。

## 当前架构

- `backend/`：Go `companiond`，包含配置、opaque cookie auth、CSRF/Origin、
  PostgreSQL/RLS store、三类模型协议适配器、generation worker、Realtime SSE、
  Memory/Consent/Report/Export 和管理员 provider/model routing；
- `frontend/`：uni-app H5，Vue 3 + TypeScript + Pinia；
- `backend/internal/migrate/sql/`：嵌入式顺序迁移真源，当前版本以该目录为准，由 `companiond migrate` 执行；
- `ops/deploy/`：Go-only Compose、Caddy、数据库/bootstrap 与 MinIO；
- `specs/`：Catalog、OpenAPI 与关键协议契约；
- `infra/db/`：迁移、RLS、最小权限与升级验证。

默认 Compose 常驻进程只有 `companiond`、PostgreSQL、MinIO 和 Caddy。
`migrate` 与 `bootstrap` 是同一 Go 镜像的一次性启动任务。仓库不再包含旧后端源码、
构建工具或运行脚本。

## Go runtime 能力

公开探针：

- `GET /actuator/health`
- `GET /actuator/health/liveness`
- `GET /actuator/health/readiness`
- `GET /api/v1/version`

登录后主要 API：

- opaque session：登录、登出、会话列表/撤销、改密、reauth、账号删除；
- relationship、conversation、message CRUD；
- consent、memory candidate/确认/拒绝/证据；
- report 与异步 export；
- generation intake/cancel、worker、SSE snapshot/delta/completed；
- ADMIN-only provider/model 配置、模型发现和全局路由排序。

Go v1 的明确范围与退役接口见
[`specs/catalog/go-v1-api-scope.yaml`](specs/catalog/go-v1-api-scope.yaml)。

## 页面配置模型

管理员登录后进入“管理 → 模型供应商”，可完成：

1. 新增 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 供应商；
2. 保存 Base URL 与 API Key；
3. 发现/维护模型；
4. 启用模型并调整全局主备路由顺序。

API Key 使用 `VC_CRYPTO_REST_KEY` 加密落库，读取接口不会返回明文。默认部署只通过
管理员页面和 Go API 配置模型。

## 开发与验证

```bash
# Go 后端（vendor 离线依赖）
GOPROXY=off go test -C backend -mod=vendor -count=1 ./...

# 前端
pnpm --dir frontend test:run
pnpm --dir frontend type-check
pnpm --dir frontend build

# PostgreSQL 18 + pgvector / RLS
bash infra/db/run-rls-tests.sh
bash infra/db/run-go-store-tests.sh

# Compose 配置
cd ops/deploy
docker compose --env-file .env.local config --quiet
```

## 当前边界

- Technical Alpha 严格单 runtime；PostgreSQL advisory lock 会拒绝第二个活跃实例；
- H5 与 API 只支持同源 HTTPS cookie 会话；
- 真实 provider 调用、费用和数据外发由 Owner 显式配置并自行核验；
- 不支持公开注册、真实支付或未完成合规准备的真实用户 Beta；
- 项目现状与后续项见 [`TODO.md`](TODO.md)，Agent 规则见 [`AGENTS.md`](AGENTS.md)。
