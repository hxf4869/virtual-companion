# SillyTavern 集成（V2-W03-S1 / W03 受管装配）

V2 方向（ADR-0009）的锁定 ST 宿主开发入口：真实上游栈 + 本切片脚本，全部在本机 127.0.0.1 运行。
四个上游组件由 `upstream.lock.json` 固定 commit 与原始产物 SHA256；本目录自有代码按 AGPL-3.0-only
（`package.json`），许可门禁见 `scripts/checks/license-policy.yaml` 的 `domainPolicies.stIntegration`。

两条运行入口（互相独立，可同时运行）：

- **原生（S1）**：`bootstrap.mjs` / `start.mjs`，dataRoot `dev/data`，ST 127.0.0.1:8742 + mock 8743；
  核心桥补丁不参与，`enableServerPlugins=false`。
- **受管（managed，V2-W03 集成收口）**：`assemble-managed.mjs` / `start-managed.mjs`，dataRoot
  `dev-managed/data`，ST 127.0.0.1:8752；ST 源码以「最小可重放运行副本」`dev-managed/st-run` 运行，
  集中规格的核心桥补丁打在副本上（`upstream/` 永远保持原始），`enableServerPlugins=true` 装载
  `server-plugin/virtual-companion`；W05 起入口经 Go 密码+TOTP 登录（见「登录与身份」）。
  见下文「受管（managed）运行装配」。

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
| `node scripts/assemble-managed.mjs` | 受管装配：校验 upstream 干净与依赖树 → 整体重建 `dev-managed/st-run`（复制源码树 + `node_modules` 符号链接 + 核心补丁）→ 部署 server plugin 与 `vc-model-settings` 扩展（排除 `harness/`）→ 写受管 `config.yaml`（`enableServerPlugins:true`、`enableUserAccounts:true`、SSO 头自动登录禁用）与 `derived-manifest.json`；幂等可重跑 |
| `node scripts/start-managed.mjs` | 受管启动（127.0.0.1:8752）：预检含核心补丁输入/输出 SHA、upstream 干净、部署完整性与 Go 桥接环境硬校验；缺 `VC_ST_GO_BASE_URL` / `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）/ `VC_ST_ACCOUNT_HANDLES`（非空 Go 账号→ST handle 映射）即硬失败退出，绝不静默降级回原生 Key；健康等待公开 `/auth/`；PID/日志在 `dev-managed/run/` |
| `node scripts/stop-managed.mjs` | 只停 `dev-managed/run/st.pid` 归属受管实例的进程（核对命令行，不碰 8742/8743 原生实例） |
| `node scripts/status-managed.mjs` | 只读汇报受管实例状态（JSON；登录入口 `/auth/` 探活、账号映射只报 configured 布尔，不输出密钥与映射值） |
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
`upstream/` 始终保持原始（HEAD 对锁、工作树干净），集中规格的核心桥补丁只打在运行副本上。

- **运行副本 `dev-managed/st-run`**：ST 源码树复制品（顶层排除 `.git`/`node_modules`/`data`/`backups`/`colab`）；
  `node_modules` 用符号链接指向 `upstream/SillyTavern/node_modules`（原生 bootstrap 已按锁定 package-lock
  重建并校验，受管只复用不重建）。`assemble-managed` 按集中规格（`scripts/lib/paths.mjs` 的
  `CORE_PATCH_SPECS`）对副本应用核心补丁：app 级单点登录钩子（`st-host-auth`）、登录客户端与
  F2 全链 CAS 系列、`/generate` 桥与 provider 正文日志收口（输入/输出 SHA256 硬校验，不匹配即
  失败；清单以 `CORE_PATCH_SPECS` 为准，不在此固定数量）。副本整体重建，重跑逐字节一致。
- **部署**（同为可重放派生物，整体重建）：`server-plugin/virtual-companion` → `st-run/plugins/virtual-companion/`
  （ST serverDirectory/plugins 装载点）；`extension/vc-model-settings` → `dev-managed/data/default-user/extensions/vc-model-settings/`
  （排除 `harness/` 开发验收用具）。W04 起复用 `bootstrap --offline` 将锁定 Helper / EJS / MVU
  装配到受管 dataRoot；只复用原生 `dev/vendor-cache` 静态资源（可用 `VC_ST_VENDOR_CACHE` 指定），
  不复制原生聊天、设置或凭据。派生产物记录在 `dev-managed/derived-manifest.json`；`upstream.lock.json` 不改。
- **配置与环境**：受管 `config.yaml` 与原生共用同一安全不变量体系；在原生全部保护之上，受管差异为
  `enableServerPlugins=true` 与 `enableUserAccounts=true`（Go 唯一身份经 ST 账户会话绑定本地 handle），
  并显式禁用 SSO 头自动登录（`sso.autheliaAuth` / `sso.authentikAuth` 均 `false`、
  `sso.trustedProxies=[]` 不信任任何转发头）；ST 原生登录、恢复与账号管理 API 由登录中间件拒绝
  （唯一例外：认证后的 `GET /api/users/me` 只读自身 profile），不构成第二套入口。
  `enableServerPluginsAutoUpdate=false`、扩展 `autoUpdate=false` 等其余不变量不变。
  端口默认 127.0.0.1:8752（`VC_ST_PORT` 可覆盖）；运行目录默认 `dev-managed`，dataRoot 在其 `data/`
  子目录中（`VC_ST_DEV_DIR` 可覆盖运行目录，供测试隔离；指向原生 `dev/` 会被拒绝）。
  原生（S1）离线 dev 配置不变：`enableServerPlugins=false`、`enableUserAccounts=false`，无上述
  桥接环境与登录要求。
- **启动门槛**：`start-managed` 要求 `VC_ST_GO_BASE_URL`（如 `http://127.0.0.1:8095`）、
  `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）与 `VC_ST_ACCOUNT_HANDLES` 存在且有效，否则硬失败退出
  ——受管宿主策略不静默降级回 ST 本地密钥；三者与可选 `VC_ST_GO_TIMEOUT_MS` 透传给 ST 进程环境，
  不落盘（`VC_ST_ACCOUNT_HANDLES` 预检解析后重新序列化透传，原始值与解析值都不写配置文件与日志）。
- **登录与身份（W05）**：Go 密码 + TOTP 是唯一可见登录。`VC_ST_ACCOUNT_HANDLES` 是显式私有环境变量：
  Go 账号 ID→ST 本地 handle 的 JSON 对象，不能为空映射；账号须为正整数 ID，handle 仅限字母数字与
  `_-` 且不可复用（两个账号不能绑定同一 handle），校验失败即拒绝启动。server plugin 的
  `lib/host-auth.js` 提供 app 级单点登录钩子（插件 `init` 注册到全局桥对象，`st-host-auth`
  补丁让 server-main 在 ST 用户解析、静态资源与原生 API 之前调用它）：未登录访问 `/`
  跳转 `/auth/`；`/auth/` 静态登录页（`server-plugin/virtual-companion/auth/`）与 `/auth/api/*`
  （会话查询 / 登录 / 注销 / 改密与重验证 / TOTP 设置与确认 / 恢复码）代理到 Go `/api/v1/auth/*`，
  只透传 `vc_*` cookie 与必要头，不信任 `Remote-User` 等客户端身份头；Go 会话须 ACTIVE 且已启用
  TOTP，才按映射绑定本地 handle 进入聊天空间。start-managed / status-managed 的就绪探针只读公开的
  `/auth/`（HTTP 200 + HTML）；`/version` 等其余资源都在认证之后，未认证响应不判为不健康。
- **F2 保存冲突（W05）**：聊天 JSONL 的 live revision 是唯一权威；`.vc-f2` 只存身份、墓碑与中断恢复
  信息，不构成第二份内容真源。原生保存 / 改名 / 删除 / 导入 / 群聊 / 角色批量 / DataMaid / 启动迁移
  全链路带 CAS 版本检查，force 参数不能绕过；冲突输入只保留在本页，经显式复制 / 重载才能落到新版本。
  Tavern Helper 与 MVU 的异步写入有来源守卫，不冒充原生保存链路。验收入口：
  `node scripts/accept-managed.mjs --filter auth-browser,f2-native,f2-browser`（浏览器场景需
  `VC_W03_CHROMIUM_PATH` 指向本机真实 Chromium 系浏览器）；结果状态由外层统一回填，本节不预设通过。
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
- **`ui04-browser`（可选，默认不选）**：`--filter ui04-browser` 通过完整 Go / ST 栈复用 C04 / C05 与
  UI02 基础浏览器验收，实际加载本项目聊天导航、模型投影及锁定 Helper / EJS / MVU。只使用本地合成
  provider；360 / 390 窄视口和短视口不替代目标手机或软键盘验收。只复验已有合成卡的 UI02 时，
  指定 `VC_W04_CASES=UI02 VC_ST_ACCEPT_CHARACTER=<已通过C04/C05且当前状态为8的合成卡名>`；
  原生流程会重新打开该卡、核对其合成标记和真实状态，不重跑已经通过的 C04/C05。
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
  `bootstrap`（owner binding secret 种子）→ 运行 Go（8095）→ 合成账号真实密码/TOTP 登录 →
  受管 ST（8752）与 fixture provider（8753）。
- **凭据与数据**：临时口令/令牌/Key 在进程内生成；登录口令复用已签入的公开 BCrypt 测试向量。
  仅使用合成材料，只进子进程环境与 gitignored 的 `dev-managed/`，
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
  区别）、C04/C05（原创复杂卡：真实 Helper iframe / MVU / EJS 与原生 swipe，见下小节）、C06（CHARX 自有
  资源原生导入；ST 无 CHARX 导出，不承诺）、C07（群聊指定发言/策略/停止/身份）。
- 产物：`dev/artifacts/accept-<run>/`（result.json、各用例截图、fixtures）；真实模型与目标手机为 NOT_RUN，
  不与 mock 结果混写。已知 ST 自身噪声（建群高亮的未处理拒绝等）在 result.json `error_notes` 中逐条说明。

### 复杂卡 C04/C05（真实 Helper iframe / MVU / EJS）

- 可直接导入的原生导出卡：[澄夏复杂卡](fixtures/chengxia-complex.json)。卡名保留验收时的合成标识；
  内嵌世界书、显示正则和自托管脚本引用均由真实 ST 导出，使用前先完成本目录 bootstrap。
- 用法：`node scripts/accept.mjs --only C04,C05`。C05 依赖 C04 产出的角色与候选状态（`complex.ready`），
  单独 `--only C05` 只会记 NOT_RUN。
- 卡由 `scripts/lib/complex-card.mjs` 原创合成（角色「澄夏」；`complexCard(name, book)` /
  `complexReply(trust)` / `statusPanel`），不含真实数据：`[InitVar]` 世界书条目初始化
  `trust=10 / scene / discussed_book`、关键词条目（`VC04_BOOK`）、EJS 常驻条目
  （`getvar('stat_data.discussed_book')` 为真才输出 `VC04_EJS_DISCUSS`）、两条角色正则（显示层隐藏
  `<UpdateVariable>` 协议块；`<StatusPlaceHolderImpl/>` 替换为真实 iframe 状态栏，按钮只读所在楼层变量）、
  角色脚本 `vc04-mvu` 引用自托管锁定 bundle `/user/files/mvu-bundle-d03b7dc8.js`（见 `patches/README.md`）。
- 覆盖：C04 初始化 10 → 原生生成经 MVU 解析为 15（原文保留 `_.set('trust', 15)`，显示层隐藏）→ 刷新重开
  保持 → 下一轮实际请求含 EJS 条件片段且无未替换宏；C05 原生右滑生成候选 8（不在 15 上累加）→ 刷新保持 8
  → 左滑回 15 / 右滑回 8 → 原生分支隔离 → 末条编辑后显式重算 → 重生成 → 切换聊天后迟到任务无效。
  编辑最后一条回复后使用卡自带的 MVU「重新处理变量」按钮；更早楼层需用 MVU 回放功能，
  不承诺任意历史编辑会自动级联重算。关键状态同时断言 `Mvu.getMvuData` 内存值、iframe 面板读数与原生 chat JSONL
  `variables[swipe_id].stat_data` 落盘。
- 回复注入：`mock-provider.mjs` 的 `POST /__replies` 接收一次性字符串队列（最多 8 条、每条 ≤16000 字符），
  按请求顺序消费，耗尽回落固定回复；进程重启即清空，仅 loopback。C04/C05 用它送入
  `complexReply(15 / 8)` 的 `<UpdateVariable>` 文本，不涉及任何真实模型。
- 产物：`dev/artifacts/accept-<run>/fixtures/` 保存导入卡 JSON 与 C04.4 原生导出的
  `complex-card-export.json`，截图 `C04-desktop.png` / `C05-swipes.png`。这些只是本地合成验收生成物，
  不构成目标手机或真实模型证据。
- 边界：仅本地合成模型；W05 F2、记忆注入、真实手机与真实模型均待后续工作项，不得据此声称 PASS。
  当前验收结果统一见仓库 `TODO.md` 的 V2-W04。

## 保护范围与边界

- 仅监听 127.0.0.1：whitelist 限 loopback、CSRF 开启、无 basicAuth / CORS proxy / 各类自动更新与
  模型自动下载关闭；安全不变量集中在 `scripts/lib/config.mjs`（原生 `CONFIG_INVARIANTS`；受管
  `MANAGED_CONFIG_INVARIANTS` 在原生集合上覆盖 `enableServerPlugins=true`、`enableUserAccounts=true`，
  并断言两种 SSO 头自动登录均禁用），start / start-managed 预检与
  status / status-managed 分别核对。受管 server plugin 装载即受管：Go 桥接环境（base URL / token /
  账号映射）缺失或非法时启动硬失败，不静默降级回 ST 本地密钥。
- `dev/data`、`dev-managed/data` 目录 0700 / 文件 0600（start 后收紧）；磁盘卷加密状态由
  protection-report 如实报告（FileVault Off 即 D01.a BLOCKED，待 Owner 开启，脚本不推断为已保护）。
- 只使用合成数据与合成 key（`VC_ST_MOCK_EXPECT_KEY`，默认 `vc03-synthetic-key`）；禁止真实私人数据、
  真实 provider 凭据或正式 Key 进入 `dev/`、`dev-managed/`、日志与任何提交物；受管
  `VC_ST_PLUGIN_SERVICE_TOKEN` 与 `VC_ST_ACCOUNT_HANDLES` 只经进程环境注入，不落盘、不进日志与
  status 输出。
- Tavern Helper 为 PolyForm-Noncommercial：禁止商业使用，禁止向 Owner 以外的人提供本服务（ADR-0009 §3/§4）。
- 备份只打包显式保护清单（chats、group chats、groups、characters、worlds、backups、OpenAI Settings、
  user 资源、settings/secrets、cookie-secret、config.yaml），排除可确定性再生的自托管派生文件与
  `extensions/`；keyfile 不得位于 dataRoot 内、不得与归档同目录。

### W06 持久来源对账

Go 进程设置 `VC_ST_HOST_BASE_URL` 为该受管 ST 的内部地址（本机开发为
`http://127.0.0.1:8752`），与 ST 共用 `VC_ST_PLUGIN_SERVICE_TOKEN`。该令牌仅用于
服务端私有通道；`POST /internal/v1/st/sources` 拒绝浏览器 Origin，以 Go 账号映射选择
唯一用户根。未配置或读取失败时来源为待核对，不能把缺失响应当作删除。

ST JSONL 的 F2 revision 是持久权威；`vc_message_id` 与每个 swipe 的 `extra.vc_source`
记录稳定来源身份。Go 只保留已核对索引和加密来源快照。打开、重连、保存后通知加速对账，
检索与提取提交仍独立读回，因此关闭浏览器不会使旧来源永久有效。

### W06 数据副本与删除

- **入口**：Owner 的数据副本与账号删除入口在 ST 扩展菜单「数据副本与删除」（`vc-model-settings`
  扩展）。扩展只是入口与状态展示：导出/删除实际由 Go `/api/v1/exports` 与 `/api/v1/auth/account`
  执行，密码确认、一次性下载令牌等语义以 Go API 为准。
- **跨存储前提**：完整（受管）模式设置了 `VC_ST_PLUGIN_SERVICE_TOKEN` 时，Go 启动即校验
  `VC_ST_HOST_BASE_URL` 必须指向该 ST 的内部地址（见上节），缺失或非法是启动校验失败，
  不会带病进入运行态。运行中 ST 不可达才是 PENDING 语义：需要 ST 数据域的导出任务保持 PENDING
  （`errorMessage=ST_UNAVAILABLE`，同一任务恢复后自动继续），账号删除保持 202 PENDING，
  由后台任务重试至确认。
- **导出语义**：完整副本 `snapshotMode=PER_FILE_AND_QUERY`——ST 私有内容按文件逐个捕获（凭据、
  历史备份、可再生缓存与锁定受管扩展可重新生成的调试 source map 排除；settings 副本剔除凭据值，
  运行代码与私人扩展仍保留在副本中），Go 侧记录按有界查询导出，两者经来源绑定与
  任务结果合并进下载文档的 `v2` 域（`go` / `st` / `domains` 覆盖清单）。ST 在线副本上限 64 MiB 与
  10000 个文件，超限任务显式失败（`ST_EXPORT_TOO_LARGE`），绝不静默截断。
- **删除语义**：Go 先落删除意图并冻结该账号；ST 私有根清理未确认时删除返回 202
  `{status:"PENDING",pendingDomains:["ST"]}`，对象存储清理失败保持 503 与 pending 信息；
  会话查询可见 `deletionPending`。确认完成后才返回 200 `{"ok":true}`。
- **账号映射登记**：ST dataRoot 下的 `_vc_accounts/`（各用户根目录的兄弟目录，即
  `DATA_ROOT/_vc_accounts/<ownerAccountId>.json`）持久保存账号映射与删除状态
  （ACTIVE/DELETING/DELETED），重启保留。删除的冻结与幂等重试依赖它；清空该目录不受支持，
  也不会恢复账号——Go 侧删除意图与账号 tombstone 独立存在。
  首次认证进入 ST 时，经私有服务通道把账号→handle 登记到 Go；尚未创建聊天的私有角色、世界书
  也进入导出与删除范围。以后移除 ST 通道配置不会把已登记的数据域误报为不存在，相关任务仍待处理。
- **ST 来源提取现状**：ST 持久来源的记忆提取复用既有任务队列与用量账本（与 MEMORY_EXTRACT
  同队列、同 attempt/计费记账），用途绑定固定为 `MEMORY_EXTRACTION_DEDUP_SUMMARY`，缺失即显式
  失败，不回落前台/全局 provider。当前 Go 后台尚未接线钉住的生成参数：该用途绑定钉了
  temperature/topP/reasoningEffort 时任务以 `EXTRACTION_PARAMETERS_UNSUPPORTED` 显式失败，
  W09 补齐前不要为该用途钉参数。
- **边界**：离线备份策略与恢复后的清理属 W16，本节不承诺任何保留期限或部署形态；当前无外部
  记忆引擎（导出 `domains` 中 `EXTERNAL_MEMORY_ENGINE` 为 NOT_APPLICABLE），inbox/通知尚未
  投产，均不在本节声称范围。
- **验收入口**：`node scripts/accept-managed.mjs --filter source-native,rights-browser,rights-native`；
  浏览器路径使用上文 `VC_W03_CHROMIUM_PATH`。覆盖实际来源读回、桌面/手机宽度页面、一次性副本、
  ST 不可用后的同任务恢复与独立合成账号清理，不使用真实 Owner 数据。
