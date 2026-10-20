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
