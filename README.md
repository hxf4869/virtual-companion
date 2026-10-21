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

2026-10-21 账号注销的归属与反馈收口（VC-R16）：注销的服务端契约（当前密码
校验、owner-bound intent、cancel 信号、vc_user cascade）不变，成功响应不再
携带任何 Set-Cookie——与 VC-R15 同型竞态：迟到的注销 200 携带的过期 Cookie
按名+路径寻址，会把较新登录刚装好的 vc_session/vc_csrf 从浏览器删掉。Go
httptest 真实 HTTP+标准 cookiejar 加响应闸门先复现（红：注销服务端完成后 B
同 jar 新登录，放行旧 200，B GET /auth/session 401、迟到响应携带 2 条过期
Set-Cookie），修复后同断言转绿；旧 token 显式重放 401、已删账号密码登录 404、
错误密码原会话保留对照保持（owner-aware fixture 只模拟注销的认证侧效果，
不冒充 SQL cascade 验证）。OpenAPI /api/v1/auth/account 修正 Bearer 描述为
cookieAuth 覆盖与 200 无 Cookie 语义（该端点实际只认 Cookie 会话+CSRF），
dist/snapshot 再生成。前端 onConfirmDelete 按提交时账号归属门控：注销是
账号级后置条件（不同于 R15 改密的 credentialEpoch 凭据级让位），迟到成功仅
在当前身份仍为提交账号时本地退出+去登录页——同账号 DELETE 完成前重登仍退出；
换号 B 或已匿名静默让位不清新身份、不重置新登录流程、不导航。非 ok/断连
文案改为「无法确认」表述（404 隐藏存在性、503 可能 intent 已持久化；401 由
transport 清会话不走该文案），busy=delete 期间「取消」禁用（intent 已提交
不可撤回）、提交前取消保留（新增 6 项用例：初跑 5 失败，其中 false 文案用例
初以 401 fixture 构造、后按 401 会被 transport 拦截的真实语义改 503；同账号
锚定用例基线即绿）。浏览器 390x844 合成 mock 实测（session vcr16，/api/v1
fail-closed、外部请求零发出）：A 注销挂起→底栏 tab-chats→受保护读取 401→
真实登录 UI 完成 B→释放 A 旧成功（真实 200 送达、无 requestfailed），修复前
B 被清+拽回登录页（红），修复后停留 B 聊天页（既有「聊天还没准备好」状态，
仅验证认证/导航归属）、底栏保持、无登录表单（绿）。scripts/check.sh 14s 全
PASS（含前端全量 709 项与 type-check）。请求侧排序、其余 API Cookie 竞态与全局 Bearer 契约留待后续模块核查；
真机浏览器验证仍为 Owner 人工项。

2026-10-21 会话撤销响应归属收口（VC-R17）：两个 Catalog SIMPLIFY 保留、
无 H5 入口的后端安全接口（DELETE /api/v1/auth/sessions/{sessionId}、POST
/api/v1/auth/sessions/revoke-all，前端本轮零改动）成功响应不再携带任何
Set-Cookie——与 R12/R15/R16 同型竞态：single 自撤销原清 2 条、revoke-all
原清 3 条过期 Cookie，按名+路径寻址会把较新登录刚装好的凭据从浏览器删掉。
服务端撤销语义不变：single 只撤销 owner 指定会话（独立 trusted-device
不动），all 原子撤销发起账号全部 opaque sessions 与 trusted-device
（V116/V123 既有 SQL 未动）。Go httptest+真实 cookiejar 响应闸门先红
（single：迟到 200 携带 2 条过期 Set-Cookie、B 新登录 GET /auth/session
401；all：3 条且 B 的 vc_trusted_device 亦被删）后绿；对照保持：旧 token
显式重放 401，single 后非目标另一会话仍 200、独立 trusted 仍免 TOTP，
all 后两个旧会话均 401、旧 trusted 回 TOTP_REQUIRED（不冒充 SQL/RLS 集成
验收）。OpenAPI 两 operation 补 200 无 Cookie 语义，single 200 的「or
already absent」按真实 store ErrNotFound→404 NOT_FOUND_OR_FORBIDDEN 契约
纠正并新增 404 条目（不扩大全局 Bearer）；scope 两项仍 SIMPLIFY 且
currentH5Callers=[]，dist/snapshot 与 catalog.snapshot.json 工具再生成。
验证：scripts/check.sh --quick PASS；GOPROXY=off go test -C backend -mod=vendor -count=1 ./internal/httpapi
PASS（含新增 2 项护栏）。请求侧排序与其余 API Cookie 竞态留待后续模块
核查；真机浏览器验证仍为 Owner 人工项。

2026-10-21 认证契约元数据对齐（VC-R18）：当前 Go 注册 70 个 /api/v1
operation 中 45 个有效 bearerAuth（5 显式+40 继承根）修正为唯一
cookieAuth，注册面现为 62 cookieAuth + 8 public、零有效 Bearer；运行时
本就只认 vc_session Cookie，未恢复 JWT/Bearer。cookieAuth 描述补真实写
请求要求（X-CSRF-Token 匹配 vc_csrf；Origin 须精确命中允许列表、缺失
即拒）。54 个未注册 DEFER/RETIRE、根级 security 与其他 scheme 未动，
legacy 不代表现有 runtime。内联映射验证（70 路由=scope 集合、45→0、124
operation 与其余字段不变）与 `scripts/check.sh --quick` 均 PASS。

2026-10-21 SSE 机器契约与真实帧对齐（VC-R20）：GET /api/v1/realtime/
streams/{generationId}（openRealtimeStream）按 Go v1 现状改写——删除 5 个
退役 required ticket query 绑定（ticketId/secret/sessionId/origin/
streamEpoch），保留 GenerationId；Last-Event-ID 为 optional header 且 Go
忽略（本地伪序号，非持久游标）；Origin 明确为 optional header（缺失允许、
有值须命中 allowlist 否则 403）。响应补真实 403/404/503，429 纠正为
INVALID_REQUEST + 每代 8 个 live 订阅上限 + Retry-After 固定 1s。
RealtimeStreamEvent 由 event/id/data 对象改为表示 SSE 文本流的 string
schema（七事件名、{event,text}/{event} 两种 data JSON、无 id/epoch/seq、
不按 Last-Event-ID 重放），200 媒体 example 给真实三帧（含空行）。退役
POST tickets 与其两个 schema、其余 operation/security（R18 cookieAuth）
未动；Go/前端零代码改动。dist 工具再生成；结构化 diff 确认全树仅此
operation 与该 schema 变化，`scripts/check.sh --quick` 与
`git diff --check` PASS。

2026-10-21 恢复可复现本地 E2E 验收环境（VC-R21）：R19 证实的 MinIO/mc
pinned OCI 镜像不可得，按改获取路径处理——新增 E2E 专用
`scripts/dev/Dockerfile.e2e-minio-tools`（scratch、arm64/amd64 双消费者
stage、`ADD --checksum` 固定官方 GitHub Release 静态二进制：minio
RELEASE.2025-09-07T16-13-09Z、mc RELEASE.2025-08-13T08-35-41Z；非重建
原 OCI digest），`scripts/dev/e2e-stack.sh` 改为 stdin Dockerfile 空
context 构建并经 --iidfile 把同一不可变 id 共享给 MinIO 与 mc（PG 镜像
不动）；scratch 无 shell，mc 改用标准 config v10 私有 JSON（0600 单文件
只读 bind + --config-dir、MC_UPDATE/MINIO_UPDATE=off），凭据不进
argv/日志/镜像层，bucket 初始化 rc 受检。验证（本机 linux/arm64，amd64
stage 存在但本轮未构建/执行）：两二进制 --version 与
pin 一致；隔离冒烟 health/mb/ls 通过；真实旅程 03-home-chat（chromium、
workers 1、trace off、专用端口 5197/18087/18437/19097、MinIO 随机
loopback）1 passed 0 failed rc=0，栈清理核验通过；`scripts/check.sh
--quick` 与 `git diff --check` PASS。R19 NOT_RUN 历史保留；MinIO 上游
归档/生产存储选型仍为 Owner 统一处理项；其他旅程与引擎未跑，
Owner/Beta/CI/真 provider 现状不变、不勾选。

2026-10-21 断线与刷新后的真实聊天恢复（VC-R22）：04-realtime-recovery
首跑暴露恢复链路缺陷并修复——reload 时生成仍在途，recoverInFlight 经
SSE 回放直完成，过渡行无真实消息 ID，历史到达后按 ID 去重失效，页面
持久渲染两条相同 assistant 气泡。修复复用既有有界 confirmFinalIdentity
核对真实 assistantMessageId（与 send() 对称），保留 null-ID 过渡
fallback、不做正文去重，新增 chat.spec T-37c 回归。验证（OrbStack
linux/arm64、chromium/390×844）：初轮 1 FAIL 1 PASS rc=1 → 修复后
2 PASS rc=0（38.6s）；user/assistant 各 1 与 generation POST 恰 1 为
GREEN 时实测；frontend 710/710 + type-check PASS；栈清理核验通过。
客户端 abort 与 FAILED_FINAL 不据此证明服务端 upstream 资源已释放；
其他旅程与引擎未跑，Owner/Beta/CI/真 provider 现状不变、不勾选。

2026-10-21 真实登录与受保护深链返回（VC-R23）：01-login-return
既有旅程首跑即通过、零代码改动——未登录访问 conversations 深链被
守卫重定向到登录页并保留 return，未知合成账号错误凭据真实 POST
/api/v1/auth/login 得 404、错误文案与账号焦点回位，provisionUser/
uiLogin 走真实 UI 登录（authenticator 挑战）后返回原深链见
“全部会话”（03/04 的 shared 会话不能替代该覆盖）。验证（OrbStack
linux/arm64、chromium/390×844）：1 passed 0 failed rc=0（52.6s），
端口释放与本轮容器 0 核验通过；其他旅程与引擎未跑，Owner/Beta/CI/
真 provider 现状不变、不勾选。

2026-10-21 可信设备再次密码登录（VC-R24）：02-auth-trusted-device
既有旅程首跑即通过、零代码改动——合成用户首次真实 UI 登录勾“信任此
设备 90 天”，account 页退出后再次输入正确密码，实际 POST
/api/v1/auth/login ok 且 nextStep=ACTIVE，直达首页且“验证登录”挑战
0 个；仅声明该观测，不外推未测安全场景。验证（OrbStack linux/arm64、
chromium/390×844）：1 passed 0 failed rc=0（38.6s），端口释放与本轮
容器 0 核验通过；其他旅程与引擎未跑，Owner/Beta/CI/真 provider
现状不变、不勾选。

2026-10-21 陪伴偏好与记忆开关真实保存（VC-R25）：
12-companion-memory-pages
既有旅程首跑即通过、零代码改动——陪伴者名“小白”、SHORT 回复长度、
MEDIUM 主动程度保存（useCompanionPrefs 以服务端返回更新 baseline）
后离页到 account 再返回，值与选择仍正确；memory 自动记忆默认 enabled、
关闭后离页回读 false 且空态、可恢复 true。仅验证偏好与开关持久化/
可见状态，不声称记忆提取质量或完整记忆生命周期。验证（OrbStack
linux/arm64、chromium/390×844）：2 passed 0 failed rc=0（37.6s），
端口释放与本轮容器 0 核验通过；其他旅程与引擎未跑，Owner/Beta/CI/
真 provider 现状不变、不勾选。

2026-10-21 消除 OpenAPI 同名 Schema 覆盖（VC-R26）：canonical
`specs/openapi/virtual-companion.yaml` 的
`components.schemas.MemoryAutoSavePref` 曾重复定义 2 次（仅
description 不同），普通 PyYAML safe_load 静默取后者，违反
YAML 1.2.2 §3.2.1.1 mapping 键唯一要求。删除前面被覆盖的 8 行定义、
保留现生效后定义（V66 §7.4），未改自动记忆默认值/接受语义/RETIRE/
其他 description，Go/前端零代码改动。验证：内联 yaml.compose 确认
修复前全文档重复键仅此一组、修复后 0 组且该 schema 恰 1 次；
safe_load 前后全树严格相等；dist 工具再生成后 api-bundle 与 HEAD
语义严格相等（该 schema 块因 PyYAML 重复键保留首现插入顺序，从首现
位置移至真实后位置，块内容逐字不变），snapshot 仅 source.sha256
变；`scripts/check.sh --quick` 与 `git diff --check` PASS。

2026-10-21 供应商故障的真实产品反馈（VC-R27）：07-provider-faults
既有安全注入与 timeout 两阶段旅程首轮因过时文案期望 FAIL（产品现行
文案为“这次回复没有完成，点此重新尝试”，见 N-05 状态矩阵），仅同步
该一行 E2E 期望后复跑 1 passed 0 failed rc=0（38.9s），两阶段断言
全过：注入轮状态“这句话暂时无法回应”、无 assistant 正文、不泄露注入
片段；timeout 轮 POST 接受带 x-request-id、generation durable
FAILED_FINAL，错误文案与 retry 按钮可见、无 Provider/SSE/FAILED_FINAL
内部细节。首轮失败点之后的断言当时未到达，不计入首轮结果；retry 仅
断言可见，未实际点击。前端 710 用例与 type-check PASS，产品代码零改。
仅验证本机合成故障路径，不声称真实供应商可用性或临床/安全认证。
端口释放与本轮容器 0 核验通过；不勾 Owner/Beta/CI/真机/真 provider。

2026-10-21 双引擎移动端可访问性与页面适配（VC-R28）：08-accessibility
既有旅程在 webkit-iphone 与 chromium-android 两个已配置 project
（workers=1 顺序执行，共 2 次实际运行）首轮 2 passed 0 failed
rc=0（42.0s）。Root 复核发现验收时机缺口：navigateToPage 只等
hash、ConsumerShell 的 role=main 在加载态即渲染，Axe 可能审到
骨架内容。仅测试侧修复：08 保留 role=main 原检查，在每页 Axe 前
等待该页现有成功内容（home-hero、message-input、conversations-
list/empty 互斥成功态、account-email=session.email 且 trusted-
devices 脱离 loading/error 后出现列表或明确空态；未新增生产
testid 或任意 sleep，未扩 helper 机制）。修复后受影响复跑 2
passed 0 failed rc=0（48.6s；webkit-iphone 4.0s、chromium-
android 1.6s），登录禁用/可提交态、四页 Axe 零违规且无横向溢出、
Home 底栏 52–54px 不超视口底全部通过；前端 710 单测+type-check
PASS，产品代码零改。该验收为 Playwright 设备仿真（iPhone 13
viewport 390×664、Pixel 5 viewport 393×727 的 webkit/chromium
双引擎），非真机 VoiceOver/输入法或生产环境验收。两轮栈自动清理
核验：state/auth 临时材料无残留、5197/18087/18437/19097 四端口
释放、本轮容器 0；不勾 Owner/Beta/CI/真机。

2026-10-21 消费者与管理端导航旅程（VC-R29）：10-navigation-smoke
与 11-admin-console 两旅程在全新隔离栈一次通过（2 passed 0 failed
rc=0，40.0s）。10 覆盖三入口底栏精确顺序「首页/聊天/我的」、聊天
上下文进入全部会话二级页（底栏不重复出现）、我的页四设置区
（陪伴/账号/安全/关于）与「并非真人」标识、普通账号无管理入口、
页面无 Provider/Token/Runtime 等内部术语且无横向溢出、返回 Home；
11 以合成 admin 共享 session 依次走四管理区（注册审核/账号/模型
与路由/运行状态）、路由顺序页并返回应用，旅程内 /api/v1/admin
写请求 0。产品代码与测试零改动；11 的零写仅覆盖旅程内导航，不
声称全库零写或权限全审，管理端为本地合成账号，非生产验收。栈
清理核验：state/auth 无残留、5197/18087/18437/19097 四端口释放、
本轮容器 0；不勾 Owner/Beta/CI/真机/真 provider。

2026-10-21 聊天与记忆副本真实下载链（VC-R30）：新增 13-data-export-
download 旅程，08/13 共用既有 webkit-iphone/chromium-android 双引擎
project（playwright.config 的双引擎正则改为两个明确 spec，base chromium
照旧忽略，--list 恰 4 例）。旅程以 chat 共享会话与既有合成当前密码走
真实 UI：错密码 POST /exports 实际 404 与诚实文案（只声明被拒与可纠正
再申请，不断言零副作用）；正确申请 200→真实 worker（隔离 MinIO 对象
模式）PENDING→READY→浏览器 download 事件，下载按原始字节校验文件名
格式、int64 conversationId/messageId 字段+数字边界匹配、唯一合成消息
锚点与结构计数；READY 有效期内与下载后 DOM/local/sessionStorage 均不
含真实 downloadUrl/token（布尔断言），download 路径 GET 恰 1 次且 UI
收敛「重新申请」。首轮 13 两例 FAIL 均为测试侧 fixture 问题（uni-input
外层 testid 定位、等待被 READY 移除的进度按钮），中断的旧 run2 记
NOT_COMPLETE；修正（含 READY 有效期内隐私检查）后 13×2 PASS（run2
1.0m）；收口前再加固（敏感值仅类型+长度布尔断言、下载后同查本次实
际 URL/token 的 DOM/storage）终版 13×2 PASS（run3 1.1m）。四例有效
覆盖＝08 首轮×2（2.3m）+ 13 终版×2，08 其后输入未变未复跑；前端 710
单测+type-check rc0，产品代码零改。属本地合成数据与 Playwright 设备
仿真，非真机/跨账号全审/生产/临床验收。栈清理核验：state/auth/shared/
iid 无残留、5197/18087/18437/19097 四端口释放、本轮容器 0；不勾
Owner/Beta/CI/真机。

2026-10-21 Go 镜像实测（VC-R31）：`backend/Dockerfile` 按 OrbStack linux/arm64
真实构建 rc=0，inspect.Size（packed resources）9,401,540 bytes ≈ 8.97 MiB、
USER vc；api-migration 空依赖 `--network none` 隔离容器 health 200/UP、
healthcheck healthy、非 root。属当前 package 启动验证，非 full DB/MinIO/TLS
部署验收；事实与口径见 [`docs/planning/g12-go-capacity-sample.md`](docs/planning/g12-go-capacity-sample.md) §6。

2026-10-21 自动记忆真实进程旅程（VC-R32）：12 旅程新增第三例（原两例
保留不变），以 memory 共享会话与 loopback provider 真实 UI 三段验证产品
承诺：低敏「户外」偏好 A 落为自动保存 ACCEPTED 记忆（memories API 轮询
+页面「自动保存」徽标）；真实 PUT 200 关闭开关后同一关系新会话发偏好
B，从既有 provider 请求日志断言 A 恰好出现一次且仅在专属
[VC_MEMORY_DATA] 记忆块内实际召回（新会话无历史，非回显）；停新增负例
以 runtime 现有 /actuator/prometheus 建立最小因果 barrier——B 的
COMPLETED 快照已证其 dispatchGeneration 进入（终态只证进入），串行独占
runtime 下读到确实存在且解析成功的 vc_generation_active===0 证 B 整个
handler 连同其同步 enqueue 决策已返回（终态快照/父 job DONE 在 SQL 里
先于 enqueue 发生，不构成退出证据）；barrier 后断言 `vc.enqueue_memory_extract`
（V125）在开关已关闭时必须不建 MEMORY_EXTRACT 行（无兼容分支），页面/
API 复核 A 仍在、B 未新增，结束恢复默认开启。观测迭代如实：run1 第三
例 FAIL（等待语义按 handler 关闭等待）、修正后 run2 PASS；run3 假阴性
源于 vc_generation_peak 只记录历史最大并发数（active<=peak 即不更新），
串行 A/B 峰值均为 1，peak>baseline 恒假（run4 诊断 rc=1、peak=1=
baseline 佐证，非 handler 未跑）；中间 claim 计数版经根审收窄为上述
active-only 最小版后 run6 PASS（5.3s）；前两例 run1 PASS 后输入未变未
复跑。产品代码零改，全程为测试观测修正非产品修复，不声称任何未观测
到的 pending job 曾存在；前端 710/type-check 沿用 R30（src 输入未变）；
PG 只读查询仅经 stack-state 公共元数据访问本轮自有隔离容器。属本地
合成数据，非真机/跨账号/生产验收。栈清理核验：state/auth/shared/iid
无残留、5197/18087/18437/19097 四端口释放、本轮容器 0。

2026-10-22 核心页三档视口布局验收（VC-R33）：08-accessibility 新增独立
"current product fits required viewports" case（原 a11y case、Axe 与
成功态等待逐字保留）。DESIGN §11 三档 320×568/390×844/430×932 经
setViewportSize 显式设置并断言 innerWidth/innerHeight 实际到位；匿名
无 cookie context 先审 login 三档，随后仅一次 chat 共享 cookie 会话
（零新增登录/challenge）走 home/chat/conversations/account × 三档，
每档复用 expectContentLoaded 成功态门。针对 ConsumerShell
overflow-x:clip 与 VcChatShell overflow:hidden 可能掩盖越界的
盲区，几何断言改读元素包围盒：可见 main 左右入画布（不断言长页底边）、
底栏三项（按 .vc-bottom-nav__item 计数——uni-h5 渲染 uni-button，非
HTML button）等宽 ±1px、图标/标签在自身格子与画布内、nav 底边贴合
视口、chat composer/input/send 入画布且不盖 nav；conversations 为
二级页断言底栏不重复出现。30 张截图（15/引擎）先于断言留证于 run
输出目录（--output 重定向 repo 外）。一次通过：--list 恰 4 例（原
Axe 2+新 layout 2）后正式 run 4 passed 0 failed rc=0（47.5s 含栈冷
启动；新 case webkit 2.2s、chromium 2.4s）。前端 710/type-check 沿用
R30（src 输入未变）。属 Playwright 视口+UA/touch 仿真（重置 CSS
viewport），非真机键盘/安全区/屏幕圆角验收，数据为本地合成。栈清理
核验：state/auth/shared 无残留、5197/18087/18437/19097 四端口释放、
本轮容器 0；不勾 Owner/Beta/CI/真机。

2026-10-22 聊天触摸尺寸与 AI 标识可读性修正（VC-R34）：VcChatComposer
send/stop 共享按钮与 field 末列 40→44px（DESIGN §9 触摸目标下限，自然
布局容纳、不加高度补丁），VcChatShell 头部 disclosure 10/14px→注释层
12/18px（DESIGN §4.2，复用 --vc-text-xs），文案与信息架构不变。前端
710 passed（52 文件）与 type-check rc=0；08 layout 两例 --list 恰 2 例
后 2 passed 0 failed 43.6s rc=0，30 张截图留 /tmp/vcr34 供 320/390/430
chat 复核；仍属视口仿真非真机。栈清理核验同 R33 口径全过（容器 0、4
端口释放、state/auth/shared/secrets/iid 无残留）。

2026-10-22 G12 十分钟 ready-idle 三次补测（VC-R35）：业务代码基线
HEAD `1ff0c3bc`，带本轮驱动 fixture 工作区改动用既有 g12 runner 串行
完成三次独立 600s idle runtime-only 测量，全部
PASS：idle RSS（600s 均值）21.022–22.168 MiB、全程 peak RSS ≤ 29.688 MiB、
cold start 150.3–156.5 ms；4gen+8SSE 与 16gen+64SSE 实际并发峰值 4/4、
16/16，SSE 与 100-turn soak 零错误（结构化日志全 INFO、WARN/ERROR 0）。
驱动仅补当前协议必要 fixture（项目内 loopback MinIO、owner-binding
bootstrap、成年核验 API 调用；裸 HEAD runner 不含这些、不能直接跑通），
测量逻辑与断言未改，三轮期间冻结不变。与 2026-08-30 的 60s
属不同观测窗，不跨窗计算收益；PSS、retained-stack、10 分钟 recovery、
real-provider 与 Owner gate 冻结仍开放。数字与口径见
[`docs/planning/g12-go-capacity-sample.md`](docs/planning/g12-go-capacity-sample.md) §7。

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
