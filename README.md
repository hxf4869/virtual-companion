# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前后端运行时为 Go 1.26.10
`companiond`，前台为 SillyTavern 宿主（`integrations/sillytavern/`），数据层为 PostgreSQL 18 +
pgvector。Generation、Realtime、Memory、数据权利与管理员模型配置已接入 Go
runtime；项目尚未达到真实用户或公开生产发布条件。

> 2026-10-27 起目标方向改为 V2：原生 SillyTavern 宿主 + Go 长期服务，Owner 本人非商业使用
> （[ADR-0009](docs/decisions/0009-v2-sillytavern-host-direction.md)、
> [执行计划](docs/planning/2026-10-27-v2-execution-plan.md)、[PRODUCT.md](PRODUCT.md)）。
> 旧 Vue / uni-app H5 已在 W15 删除。下文中的 H5 旅程数字是删除前的历史验证记录。

## 当前状态（2026-10-22）

工作分支 `codex/audit-remediation`。本节概览可用能力、实际验证范围、
工程待核与 Owner 待决；逐轮修复内容与验证证据保留在 Git 提交历史与
[`TODO.md`](TODO.md)「当前状态」，不在此复写。

### 用户现在能完成什么（本地栈、合成数据）

当前前台是 SillyTavern 受管宿主，入口见 [`integrations/sillytavern/README.md`](integrations/sillytavern/README.md)。
下列页面流程属于已删除的 Vue H5，只保留为当时能力记录：

- 受控账号密码登录 → 验证器挑战 → 会话；可信设备勾选后 90 天内再次
  密码登录免重复挑战；公开注册关闭；
- 与唯一默认陪伴者对话：发送消息、SSE 流式回复、断线或刷新后恢复，
  供应商故障有用户可理解的失败文案与重试；从「全部会话」继续既有对话；
- 陪伴偏好（陪伴者名称、回复长度、主动程度）保存并回读；
- 记忆：低敏偏好自动保存、新会话召回、关闭开关后停止新增提取；
- 数据权利：凭当前密码申请「聊天与记忆副本」，READY 后一次性下载；
- 管理端：三协议 provider/model 配置与全局路由，见下文「页面配置模型」。

### 实际验证范围与检查入口

- 统一检查入口 `bash scripts/check.sh`（仓库约束 + Go 单测 + ST 集成单测），
  SQL/RLS 隔离脚本在 `infra/db/`；各轮改动按影响范围定向
  验证，结果记录在对应提交与 [`TODO.md`](TODO.md)，历史全量结果只按
  当时输入范围有效，不升级为当前整仓保证；
- 已删除的 Vue 前端曾在 VC-R52 记录全量测试 735 项与 type-check；
- 已删除的 Vue 隔离栈 E2E（当时路径 `frontend/e2e/journeys/`）：
  2026-10-22 VC-R41 无过滤一次跑完当时核心 18 实例（3 projects/10 files）
  18/18 PASS（历史记录按当时输入保留）；同日 VC-R52 落地跨 Tab 错账号修复后
  同入口复跑 20 实例（18 + 新 R48 跨 Tab 用例双引擎）20/20 通过（1.9m）。
  其中 08 可访问性与三档（320/390/430）视口布局两例、13 副本
  下载为 webkit+chromium 双引擎设备仿真，其余旅程为 chromium 手机视口；
- G12 runtime-only 容量采样：三次独立 600s ready-idle 全部 PASS（idle
  RSS 均值 21.022–22.168 MiB），Go 镜像 OCI 事实（packed resources
  ≈8.97 MiB、非 root）为既有 package 启动验证，两者口径见
  [`docs/planning/g12-go-capacity-sample.md`](docs/planning/g12-go-capacity-sample.md) §6–§7；
- 以上均为本地合成数据与 fake/loopback provider，非真机、真实 provider
  或生产环境验收；CI 远端 NOT_RUN（CI 仅由 `main` 触发）。

### 工程待核（代码侧，未完成或未修复）

- 认证写请求的请求侧排序与其余 API Cookie 竞态边界仍开放（R12/R15/
  R16/R17 收口的是响应侧，不覆盖请求侧；VC-R52 已覆盖跨账号场景：core
  写强制 `X-VC-Expected-Account-ID` 前置条件，陈旧页面的写被服务端 409
  拒绝且客户端恢复当前 Cookie 身份；VC-R169 追加会话级前置
  `X-VC-Expected-Session-ID`（身份响应新增非凭据 `sessionId`），同账号重登
  后旧页持旧会话编号的写同样 409 并经既有 reconcile 恢复。仍不覆盖：页面
  已发出的旧 Cookie 请求排序与未认证登录 Set-Cookie 竞争；配套版本约束：
  H5 与 API 需一起更新，旧缓存页面需刷新，新前端解析 REQUIRED sessionId
  时对旧后端身份响应不可用）；
- 本地 credentialEpoch 仍不能感知另一标签页登录。VC-R39 只收口 Admin
  退出确认窗这一个窗口：手机 390x844 原视口下旧遮挡实为底栏
  model-mobile-bar 与导航同层（非 modal），抽屉改用既有 overlay 层级后
  已真实点通并复现 auth 红（B GET 200 → 旧确认 logout 200 → B GET 401）；
  壳层以确认前后 CSRF cookie 变化撤销旧意图并提示重新确认，11 旅程两例
  2 passed（撤销段 logout 0 次且 B 保持 200，同页二次确认正常退出只撤
  S1）；其余请求侧浏览器 Cookie 时序仍未闭合；
- G12 工程收尾：10 分钟 recovery、retained-stack 与 PSS 补测未完成，
  不可用 60s recovery 或 600s ready-idle 冒充（观测窗不同，口径见
  [`docs/planning/g12-go-capacity-sample.md`](docs/planning/g12-go-capacity-sample.md) §7）。

### 仍需 Owner 决策或执行

- G12 gate 冻结与 real-provider dogfood（真实凭据与费用外发须 Owner
  授权），条目不勾；
- 真机人工项：中文 IME（`DOGFOOD-11`）、副本真机下载与保存、无障碍与
  换号/登出竞态的真机浏览器验证；
- provider 条款/revision 确认与费用外发、生产存储选型（MinIO 上游归档）；
  真实用户 Beta 前置（PIA、成年验证、值班）与 7 天 dogfood、D0 等
  仍待 Owner 决策或执行，具体清单见 [`TODO.md`](TODO.md)。

项目仍未达到公开生产可发布条件，未决清单以 [`TODO.md`](TODO.md) 为真源；
产品范围以 [`PRODUCT.md`](PRODUCT.md) 为准，API 范围见
[`specs/catalog/go-v1-api-scope.yaml`](specs/catalog/go-v1-api-scope.yaml)。

## 2026-09-06 修复轮状态（历史快照）

当时基线 HEAD `02c1fe91367b015443ec059264fd4d5273691ca0`，授权批次 N-00～N-08
（对应评审发现 F-01～F-08），逐项完成情况以后续提交与对账记录为准，不按提交
名回溯勾选。验证以本地入口为准：`bash scripts/check.sh`、`infra/db/` 隔离
脚本、定向 Vitest。历史文档中的 Owner-only 描述是时序差异，不代表新版产品
范围。

## 快速开始

```bash
# 日常检查：契约/生成物、Go 单测、ST 集成单测
bash scripts/check.sh
```

V2 在本机受管栈运行。启动、停止、状态、日志、备份、恢复，以及未执行的升级／回退说明，写在
[`integrations/sillytavern/README.md`](integrations/sillytavern/README.md)「本机运行说明」。
2026-10-29 已在本工作树的合成环境执行那些命令（ST `9852`、Go `9195`、MemoryCore `9854`，容器 `vc-w16-*`）。
远端部署未授权（[`TODO.md`](TODO.md) 的 `V2-OWNER-DEPLOY`）。

`ops/deploy` 的 Compose 只运行 `companiond`、PostgreSQL、MinIO 和 Caddy，不含 SillyTavern，不含 MemoryCore，不是 V2 栈。
W16-2 没有重跑下面的 Compose 命令：

```bash
cp ops/deploy/.env.example ops/deploy/.env.local
# 填写 ops/deploy/.env.local，真实 Secret 不入库
cd ops/deploy
docker compose --env-file .env.local up -d --build
```

浏览器前台用 SillyTavern 受管宿主，见 [`integrations/sillytavern/README.md`](integrations/sillytavern/README.md)。
Go-only Compose 的证书与验证步骤见 [`ops/deploy/README.md`](ops/deploy/README.md)，
同一 Compose 的 Owner-only 联调见 [`ops/deploy/DOGFOOD.md`](ops/deploy/DOGFOOD.md)。

## 当前架构

- `backend/`：Go `companiond`，包含配置、opaque cookie auth、CSRF/Origin、
  PostgreSQL/RLS store、三类模型协议适配器、generation worker、Realtime SSE、
  Memory/Consent/Report/Export 和管理员 provider/model routing；
- `integrations/sillytavern/`：V2 SillyTavern 宿主、扩展与 server plugin；
- `backend/internal/migrate/sql/`：嵌入式顺序迁移真源，当前版本以该目录为准，由 `companiond migrate` 执行；
- `ops/deploy/`：Go-only Compose（`companiond`、PostgreSQL、MinIO、Caddy）。不含 SillyTavern 与 MemoryCore，不是 V2 栈；
- `specs/`：Catalog、OpenAPI 与关键协议契约；
- `infra/db/`：迁移、RLS、最小权限与升级验证。

`ops/deploy` 的常驻进程只有 `companiond`、PostgreSQL、MinIO 和 Caddy（API 的 TLS 边缘）。
它不启动 SillyTavern 或 MemoryCore。V2 的浏览器前台是本机受管宿主，不由这份 Compose 或 Caddy 提供。
远端部署未授权（`V2-OWNER-DEPLOY`）。
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

模型目录的权威在 Go。浏览器里的供应商页面在 SillyTavern 扩展中，不在已删除的 Vue 管理页。
管理员完成：

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

# ST 集成离线单测（Node 22.13+；浏览器验收不在此命令）
node --test "integrations/sillytavern/tests/*.test.mjs"

# PostgreSQL 18 + pgvector / RLS
bash infra/db/run-rls-tests.sh
bash infra/db/run-go-store-tests.sh

# Compose 配置
cd ops/deploy
docker compose --env-file .env.local config --quiet
```

Vue HTTP/TLS Playwright 栈和 `scripts/dev/close-http-e2e-stack.mjs` 已随旧前端删除。
受管浏览器验收入口在 [`integrations/sillytavern/README.md`](integrations/sillytavern/README.md)，不进 `scripts/check.sh`。

## 当前边界

- Technical Alpha 严格单 runtime；PostgreSQL advisory lock 会拒绝第二个活跃实例；
- Go API 使用 opaque cookie 会话；浏览器前台是 SillyTavern 受管宿主；
- 真实 provider 调用、费用和数据外发由 Owner 显式配置并自行核验；
- 不支持公开注册、真实支付或未完成合规准备的真实用户 Beta；
- 项目现状与后续项见 [`TODO.md`](TODO.md)，Agent 规则见 [`AGENTS.md`](AGENTS.md)。
