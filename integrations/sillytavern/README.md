# SillyTavern 集成（V2-W03-S1 / W03 受管装配）

V2 方向（ADR-0009）的锁定 ST 宿主开发入口：真实上游栈 + 本切片脚本，全部在本机 127.0.0.1 运行。
四个上游组件由 `upstream.lock.json` 固定 commit 与原始产物 SHA256；本目录自有代码按 AGPL-3.0-only
（`package.json`），许可门禁见 `scripts/checks/license-policy.yaml` 的 `domainPolicies.stIntegration`。

两条运行入口（互相独立，可同时运行）：

- **原生（S1）**：`bootstrap.mjs` / `start.mjs`，dataRoot `dev/data`，ST 127.0.0.1:8742 + mock 8743；
  两个核心桥补丁不参与，`enableServerPlugins=false`。
- **受管（managed，V2-W03 集成收口）**：`assemble-managed.mjs` / `start-managed.mjs`，dataRoot
  `dev-managed/data`，ST 127.0.0.1:8752；ST 源码以「最小可重放运行副本」`dev-managed/st-run` 运行，
  两个核心桥补丁打在副本上（`upstream/` 永远保持原始），`enableServerPlugins=true` 装载
  `server-plugin/virtual-companion`。见下文「受管（managed）运行装配」。

## 首次准备

1. `upstream/`（gitignored）：按 `upstream.lock.json` 克隆四个仓库并 checkout 锁定 commit
   （bootstrap 不自动克隆，避免隐式网络写操作）：
   - SillyTavern 1.19.0（`7e8663cd9`）
   - Tavern Helper / JS-Slash-Runner 4.11.3（`0af42106`，PolyForm-Noncommercial → 仅 Owner 本人非商业使用）
   - ST-Prompt-Template 1.17.9（`d6f520d1`）
   - MagVarUpdate（MVU）（`d03b7dc8`）
2. `npm ci`（安装 `devDependencies: playwright-core`，驱动本机 Chrome 做验收）。
3. `node scripts/bootstrap.mjs`：校验上游 commit/产物 SHA → ST 依赖树按锁 `npm ci`（联网）→
   下载 `vendor.lock.json` 固定的 npm 官方 tarball（联网，逐文件 sha256）→ 在 `dev/data` 重建
   dataRoot（复制 Helper/EJS、应用确定性补丁、自托管 vendor 与 MVU bundle）→ 生成 `dev/config.yaml`。
   `--offline` 复用已缓存资产；任何校验失败即硬失败，不产出半成品。

## 日常入口

| 命令 | 说明 |
| --- | --- |
| `node scripts/start.mjs` | 预检（配置不变量 / 依赖树 / 补丁与 vendor SHA / 端口）后启动 ST（127.0.0.1:8742）与本地固定 provider mock（8743）；PID 记录在 `dev/run/*.pid` |
| `node scripts/stop.mjs` | 只停 `dev/run/*.pid` 归属本实例的进程（核对进程命令行） |
| `node scripts/status.mjs` | 只读汇报进程 / `/version` / dataRoot 权限 / 配置不变量 / 依赖树与补丁、vendor 完整性（JSON） |
| `node scripts/assemble-managed.mjs` | 受管装配：校验 upstream 干净与依赖树 → 整体重建 `dev-managed/st-run`（复制源码树 + `node_modules` 符号链接 + 两个核心补丁）→ 部署 server plugin 与 `vc-model-settings` 扩展（排除 `harness/`）→ 写受管 `config.yaml`（`enableServerPlugins:true`）与 `derived-manifest.json`；幂等可重跑 |
| `node scripts/start-managed.mjs` | 受管启动（127.0.0.1:8752）：预检含核心补丁输入/输出 SHA、upstream 干净、部署完整性与 Go 桥接环境硬校验；缺 `VC_ST_GO_BASE_URL` / `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）即硬失败退出，绝不静默降级回原生 Key；PID/日志在 `dev-managed/run/` |
| `node scripts/stop-managed.mjs` | 只停 `dev-managed/run/st.pid` 归属受管实例的进程（核对命令行，不碰 8742/8743 原生实例） |
| `node scripts/status-managed.mjs` | 只读汇报受管实例状态（JSON；Go 环境只报配置与否，不输出密钥值） |
| `node scripts/accept.mjs [--only C07]` | 真浏览器验收（下节）；不进 `scripts/check.sh` |
| `node scripts/accept-managed.mjs [--filter <场景,…>]` | 受管端到端验收（见「受管端到端验收」节）：默认 14 个接口/协议场景；`ui03-browser` 真实界面场景需显式 `--filter`；不进 `scripts/check.sh` |
| `node scripts/protection-report.mjs [--archive … --key-file …]` | C1/D01 保护清单与权限报告（只读） |
| `bash scripts/backup.sh <dataRoot> <config.yaml\|-> <out.vcbae1>` | C1 加密备份（tar → openssl aes-256-cbc → `vc_aead.py` VCBAE1 认证封装），口令用环境变量或 0600 keyfile |
| `bash scripts/restore.sh <archive.vcbae1> <空目标目录>` | MAC 先校验再解密，恢复到隔离目录（0700/0600），不覆盖原 dataRoot |
| `node --test "tests/*.test.mjs"` | 离线单测（S1 config / backup / patcher / lock 与 S3/S4 扩展、协议、桥接测试），已并入 `scripts/check.sh` 全量 |

目录：`scripts/`（入口与 `lib/` 共享实现）、`tests/`、`patches/`（确定性补丁规格）、
`dev/`（原生 dataRoot 与运行产物，gitignored）、`dev-managed/`（受管 dataRoot、st-run 运行副本与
运行产物，gitignored）、`upstream/`（gitignored）、`extension/`（S3 扩展，另见其目录）。
`.local/` 是 W00 调试遗留，gitignored，不是交付物。

## 受管（managed）运行装配

W03 集成收口的受管链路：ST 前台生成经 server plugin 桥接 Go 后端（Go 为模型目录与凭据唯一权威），
`upstream/` 始终保持原始（HEAD 对锁、工作树干净），两个核心桥补丁只打在运行副本上。

- **运行副本 `dev-managed/st-run`**：ST 源码树复制品（顶层排除 `.git`/`node_modules`/`data`/`backups`/`colab`）；
  `node_modules` 用符号链接指向 `upstream/SillyTavern/node_modules`（原生 bootstrap 已按锁定 package-lock
  重建并校验，受管只复用不重建）。`assemble-managed` 对副本应用
  `patches/st-chat-completions-vc-bridge.json` 与 `patches/st-util-stream-error-log.json`
  （输入/输出 SHA256 硬校验，不匹配即失败）。副本整体重建，重跑逐字节一致。
- **部署**（同为可重放派生物，整体重建）：`server-plugin/virtual-companion` → `st-run/plugins/virtual-companion/`
  （ST serverDirectory/plugins 装载点）；`extension/vc-model-settings` → `dev-managed/data/default-user/extensions/vc-model-settings/`
  （排除 `harness/` 开发验收用具）。派生产物记录在 `dev-managed/derived-manifest.json`；`upstream.lock.json` 不改。
- **配置与环境**：受管 `config.yaml` 与原生共用同一安全不变量体系，唯一差异
  `enableServerPlugins=true`（`enableServerPluginsAutoUpdate=false`、扩展 `autoUpdate=false` 不变）。
  端口默认 127.0.0.1:8752（`VC_ST_PORT` 可覆盖）；运行目录默认 `dev-managed`，dataRoot 在其 `data/`
  子目录中（`VC_ST_DEV_DIR` 可覆盖运行目录，供测试隔离；指向原生 `dev/` 会被拒绝）。
- **启动门槛**：`start-managed` 要求 `VC_ST_GO_BASE_URL`（如 `http://127.0.0.1:8095`）与
  `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）存在且非空，否则硬失败退出——受管宿主策略不静默降级回
  ST 本地密钥；两变量与可选 `VC_ST_GO_TIMEOUT_MS` 透传给 ST 进程环境，不落盘。
- **桥接语义**：ST 侧的模型保存、用途绑定与仅配置投影零上游请求；受控取用（显式连接检查/目录拉取）
  与生成是分开的显式动作。写请求携带 Go 会话身份快照头（`X-VC-Expected-Account-ID` /
  `X-VC-Expected-Session-ID`），revision 冲突返回 409 且界面草稿保留；模型 Key 不回显，界面只显示状态。
- **生命周期边界**：`assemble-managed` / `start-managed` 只负责 ST 侧装配与运行，不拉起完整 Go/PG/S3；
  PG（容器 `vc-w03-managed-pg`）与 Go 进程由验收侧脚本管理，手工运行受管栈需自备已就绪的 Go 服务与
  桥接配置（`VC_ST_GO_BASE_URL` / `VC_ST_PLUGIN_SERVICE_TOKEN`）。原生实例（8742/8743）与受管实例
  （8752）互不接管，`stop`/`stop-managed` 各按自己 pid 文件收口。
- 冻结端口约定：受管 ST=8752、合成 provider=8753、Go=8095；Go 侧 `VC_HTTP_ORIGINS` 需含
  `http://127.0.0.1:8752`。

## 受管端到端验收（scripts/accept-managed.mjs）

单命令拉起完整受管合成栈并跑接口/协议验收场景（不进 `scripts/check.sh`）。用法与全量场景清单
`--help` 可见；退出码 0=全部所选场景通过、2=用法错误、3=生命周期失败、4=场景失败（结果 JSON 仍写出）。

- **默认 14 场景**（无参全选）：`login-shape`（合成 Owner 登录请求形状）、`catalog-admin`（Go 建
  provider/模型/用途绑定 + UI03 API 面：保存/读回/Key 三态/独立用途/409 保留草稿）、
  `zero-upstream-on-save`（保存与仅配置投影零上游请求）、`service-resolve`（受控取用：精确 ID /
  revision 冲突 / 邻值拒绝）、`e2e-chat` / `e2e-responses` / `e2e-anthropic`（三协议经真实 ST
  `/generate`）、`tool-round`、`cancel-stream`、`context-budget`、`native-drift`、`key-revoke`、
  `revision-conflict`、`continuation-hygiene`。
- **`--filter <场景,…>`**：按场景 id 具名选择，依赖闭包自动补齐且依赖先行（如 `--filter e2e-chat`
  会自动先跑 `catalog-admin` 建目录）；`--dry-run` 只做 fixture 与断言库自检，不碰 docker/Go/ST 完整栈。
- **`ui03-browser`（可选真实界面场景，默认不选）**：`--filter ui03-browser` 显式执行，真实浏览器完成
  UI03 全流程（编辑保存读回 / 409 冲突保留草稿 / Key 只显状态 / 用途绑定投影写原生设置 / 三协议经
  原生界面发送）。浏览器由 `playwright-core` 驱动（随 `npm ci` 安装），可执行文件以
  `VC_W03_CHROMIUM_PATH` 指定本机已有 Chromium 系浏览器的绝对路径，不要求 Playwright 自带浏览器
  已下载：
  `VC_W03_CHROMIUM_PATH=/absolute/path/to/chrome node scripts/accept-managed.mjs --filter ui03-browser`。
- **夹具生命周期**：端口归属检查（ST 8752 / fixture 8753 / Go 8095 任一被监听即退出，不接管）→
  专用 loopback 容器（label `com.vc.w03=managed`，随机 127.0.0.1 端口）：PG `vc-w03-managed-pg`
  （默认镜像 `pgvector/pgvector:0.8.5-pg18`）与 MinIO `vc-w03-managed-minio`（默认镜像
  `vc-g12-minio-tools:local`，本机按 `scripts/dev/Dockerfile.e2e-minio-tools` 构建的 pinned 产物，
  脚本不自动拉取；容器名/镜像等以脚本 `VC_W03_*` 环境变量面为准）→ `companiond migrate` +
  `bootstrap`（owner binding secret 种子）→ 种子合成 Owner → 运行 Go（8095）与受管 ST（8752）、
  fixture provider（8753）。
- **凭据与数据**：口令/令牌/Key 全部进程内随机合成，只进子进程环境与 gitignored 的 `dev-managed/`，
  不打印、不写示例值，无需任何真实凭据；受管 dataRoot 跨 run 保留合成聊天与设置（UI03 文本带本轮
  唯一 scope 后缀）。产物写 `dev-managed/artifacts/accept-<ts>/`（结果 JSON + 截图，截图不含 Key）。
- **清理归属**：进程只停本轮归属（ST 经 `stop-managed.mjs` 按 st.pid 命令行核对；go/fixture 只停
  本轮实际启动的 child），容器只按 `com.vc.w03=managed` 标签移除；不 lsof 扫端口杀进程，不碰
  8742/8743 原生实例。
- **验收边界**：以上为合成环境验收；FileVault 磁盘加密、正式备份配置、真实 provider Key、预算与
  手机等 Owner 项仍未验收，不据此声称 V2 整体完成。

## 浏览器验收（scripts/accept.mjs）

- 前置：`start.mjs` 已运行（脚本不代为启动）；本机有 Chromium 系浏览器（`VC_ST_BROWSER` 可覆盖路径）。
- 用 `lib/fixtures.mjs` 生成的原创合成数据驱动真 ST 前端，固定 provider 由 `scripts/mock-provider.mjs`
  返回确定性回复；对模型请求的断言读 mock 内存捕获（`/__captures`），不落盘请求正文。
- 覆盖 VER §2 的 C01（JSON/PNG 卡）、C02（世界书关键词/次级/递归/预算/冷却）、C03（宏/预设/正则三层
  区别）、C06（CHARX 自有资源原生导入；ST 无 CHARX 导出，不承诺）、C07（群聊指定发言/策略/停止/身份）。
- 产物：`dev/artifacts/accept-<run>/`（result.json、各用例截图、fixtures）；真实模型与目标手机为 NOT_RUN，
  不与 mock 结果混写。已知 ST 自身噪声（建群高亮的未处理拒绝等）在 result.json `error_notes` 中逐条说明。

## 保护范围与边界

- 仅监听 127.0.0.1：whitelist 限 loopback、CSRF 开启、无 basicAuth / CORS proxy / 各类自动更新与
  模型自动下载关闭；安全不变量集中在 `scripts/lib/config.mjs`（原生 `CONFIG_INVARIANTS`，受管
  `MANAGED_CONFIG_INVARIANTS` 唯一差异 `enableServerPlugins=true`），start / start-managed 预检与
  status / status-managed 分别核对。受管 server plugin 装载即受管：Go 桥接环境缺失时启动硬失败，
  不静默降级回 ST 本地密钥。
- `dev/data`、`dev-managed/data` 目录 0700 / 文件 0600（start 后收紧）；磁盘卷加密状态由
  protection-report 如实报告（FileVault Off 即 D01.a BLOCKED，待 Owner 开启，脚本不推断为已保护）。
- 只使用合成数据与合成 key（`VC_ST_MOCK_EXPECT_KEY`，默认 `vc03-synthetic-key`）；禁止真实私人数据、
  真实 provider 凭据或正式 Key 进入 `dev/`、`dev-managed/`、日志与任何提交物；受管
  `VC_ST_PLUGIN_SERVICE_TOKEN` 只经进程环境注入，不落盘。
- Tavern Helper 为 PolyForm-Noncommercial：禁止商业使用，禁止向 Owner 以外的人提供本服务（ADR-0009 §3/§4）。
- 备份只打包显式保护清单（chats、group chats、groups、characters、worlds、backups、OpenAI Settings、
  user 资源、settings/secrets、cookie-secret、config.yaml），排除可确定性再生的自托管派生文件与
  `extensions/`；keyfile 不得位于 dataRoot 内、不得与归档同目录。
