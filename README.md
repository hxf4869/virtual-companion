# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前后端运行时为 Go 1.26.10
`companiond`，前端为 uni-app + Vue 3 + TypeScript，数据层为 PostgreSQL 18 +
pgvector。Generation、Realtime、Memory、数据权利与管理员模型配置已接入 Go
runtime；项目尚未达到真实用户或公开生产发布条件。

## 当前状态（2026-10-22）

工作分支 `codex/audit-remediation`。本节概览可用能力、实际验证范围、
工程待核与 Owner 待决；逐轮修复内容与验证证据保留在 Git 提交历史与
[`TODO.md`](TODO.md)「当前状态」，不在此复写。

### 用户现在能完成什么（本地栈、合成数据）

- 受控账号密码登录 → 验证器挑战 → 会话；可信设备勾选后 90 天内再次
  密码登录免重复挑战；公开注册关闭；
- 与唯一默认陪伴者对话：发送消息、SSE 流式回复、断线或刷新后恢复，
  供应商故障有用户可理解的失败文案与重试；从「全部会话」继续既有对话；
- 陪伴偏好（陪伴者名称、回复长度、主动程度）保存并回读；
- 记忆：低敏偏好自动保存、新会话召回、关闭开关后停止新增提取；
- 数据权利：凭当前密码申请「聊天与记忆副本」，READY 后一次性下载；
- 管理端：三协议 provider/model 配置与全局路由，见下文「页面配置模型」。

### 实际验证范围与检查入口

- 统一检查入口 `bash scripts/check.sh`（仓库约束 + Go 单测 + 前端测试与
  type-check），SQL/RLS 隔离脚本在 `infra/db/`；各轮改动按影响范围定向
  验证，结果记录在对应提交与 [`TODO.md`](TODO.md)，历史全量结果只按
  当时输入范围有效，不升级为当前整仓保证；
- 前端全量测试（735 项）与 type-check 随 VC-R52 改动验证；
- 真实隔离栈 E2E（[`frontend/e2e/journeys/`](frontend/e2e/journeys/)）：
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
产品范围以 [`PRODUCT.md`](PRODUCT.md) 与 [`frontend/DESIGN.md`](frontend/DESIGN.md)
为准，API 范围见 [`specs/catalog/go-v1-api-scope.yaml`](specs/catalog/go-v1-api-scope.yaml)。

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

# 默认 HTTP 全旅程（可选长检查；Go 1.26.10+ 在 PATH、Node 22、pnpm 11、OrbStack）
pnpm --dir frontend test:e2e

# 真实 TLS 全旅程（可选长检查；Node 22、pnpm 11、OrbStack）
E2E_STACK_KIND=tls E2E_RELEASE_MODE=full pnpm --dir frontend test:e2e

# PostgreSQL 18 + pgvector / RLS
bash infra/db/run-rls-tests.sh
bash infra/db/run-go-store-tests.sh

# Compose 配置
cd ops/deploy
docker compose --env-file .env.local config --quiet
```

默认 HTTP E2E 使用当前 PATH 的 Go，在独立测试数据卷和容器上运行；宿主
provider、runtime 与 Vite 进程记录 OS 启动时间，Docker 资源按本轮实际创建
收据回收。日志 HTTP_STACK_STATE/STACK_READY 给出状态文件和私有运行目录。
HTTP 状态使用 v4；旧记录缺少归属信息时显式失败并保留。E2E_STACK_KEEP=1
用于保留调试现场；synthetic-eval 只有核验恢复 SYNTHETIC/eval=false 后才解除
保留义务，恢复失败时即使启动器停止也保留本轮进程、容器和恢复记录。

显式关闭完整的 HTTP v4 保留栈（Node 22，使用日志中该轮的绝对状态文件路径）：

```bash
node --experimental-strip-types scripts/dev/close-http-e2e-stack.mjs --state /absolute/path/to/state.json
```

命令核对本轮收据、实际容器归属与运行目录后关闭进程及 Docker 资源；
synthetic-eval 若仍为该轮 BETA 会先恢复并核验，若已回到 SYNTHETIC 则直接
关闭，无需重新激活 BETA。恢复或归属核验失败时保留现场并返回非零；旧版、
不完整或缺失的记录不会自动关闭。关闭成功不改变原有 E2E 的验收结果。

TLS E2E 每轮从当前源码重建 H5 与生产派生镜像，在
`https://localhost:18457` 启动独立合成栈；可用 `E2E_TLS_PORT` 改端口。
启动器先用本轮 CA 验证证书链、主机名与实际 HTTP/2，再执行全部浏览器旅程。
它不读取部署 `.env`，也不继承 `VC_*` 生产配置；退出按本轮资源收据清理，
清理失败时保留日志给出的 state 与收据供恢复。这不是容量或真实 provider 验收。

## 当前边界

- Technical Alpha 严格单 runtime；PostgreSQL advisory lock 会拒绝第二个活跃实例；
- H5 与 API 只支持同源 HTTPS cookie 会话；
- 真实 provider 调用、费用和数据外发由 Owner 显式配置并自行核验；
- 不支持公开注册、真实支付或未完成合规准备的真实用户 Beta；
- 项目现状与后续项见 [`TODO.md`](TODO.md)，Agent 规则见 [`AGENTS.md`](AGENTS.md)。
