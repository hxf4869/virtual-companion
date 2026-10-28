# SillyTavern 集成（V2-W03-S1）

V2 方向（ADR-0009）的锁定 ST 宿主开发入口：真实上游栈 + 本切片脚本，全部在本机 127.0.0.1 运行。
四个上游组件由 `upstream.lock.json` 固定 commit 与原始产物 SHA256；本目录自有代码按 AGPL-3.0-only
（`package.json`），许可门禁见 `scripts/checks/license-policy.yaml` 的 `domainPolicies.stIntegration`。

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
| `node scripts/accept.mjs [--only C07]` | 真浏览器验收（下节）；不进 `scripts/check.sh` |
| `node scripts/protection-report.mjs [--archive … --key-file …]` | C1/D01 保护清单与权限报告（只读） |
| `bash scripts/backup.sh <dataRoot> <config.yaml\|-> <out.vcbae1>` | C1 加密备份（tar → openssl aes-256-cbc → `vc_aead.py` VCBAE1 认证封装），口令用环境变量或 0600 keyfile |
| `bash scripts/restore.sh <archive.vcbae1> <空目标目录>` | MAC 先校验再解密，恢复到隔离目录（0700/0600），不覆盖原 dataRoot |
| `node --test "tests/*.test.mjs"` | 离线单测（S1 config / backup / patcher / lock 与 S3/S4 扩展、协议、桥接测试），已并入 `scripts/check.sh` 全量 |

目录：`scripts/`（入口与 `lib/` 共享实现）、`tests/`、`patches/`（确定性补丁规格）、
`dev/`（专用 dataRoot 与运行产物，gitignored）、`upstream/`（gitignored）、
`extension/`（S3 扩展，另见其目录）。`.local/` 是 W00 调试遗留，gitignored，不是交付物。

## 浏览器验收（scripts/accept.mjs）

- 前置：`start.mjs` 已运行（脚本不代为启动）；本机有 Chromium 系浏览器（`VC_ST_BROWSER` 可覆盖路径）。
- 用 `lib/fixtures.mjs` 生成的原创合成数据驱动真 ST 前端，固定 provider 由 `scripts/mock-provider.mjs`
  返回确定性回复；对模型请求的断言读 mock 内存捕获（`/__captures`），不落盘请求正文。
- 覆盖 VER §2 的 C01（JSON/PNG 卡）、C02（世界书关键词/次级/递归/预算/冷却）、C03（宏/预设/正则三层
  区别）、C06（CHARX 自有资源原生导入；ST 无 CHARX 导出，不承诺）、C07（群聊指定发言/策略/停止/身份）。
- 产物：`dev/artifacts/accept-<run>/`（result.json、各用例截图、fixtures）；真实模型与目标手机为 NOT_RUN，
  不与 mock 结果混写。已知 ST 自身噪声（建群高亮的未处理拒绝等）在 result.json `error_notes` 中逐条说明。

## 保护范围与边界

- 仅监听 127.0.0.1：whitelist 限 loopback、CSRF 开启、无 basicAuth / CORS proxy / server plugins /
  各类自动更新与模型自动下载关闭；安全不变量集中在 `scripts/lib/config.mjs`，start 预检与 status 核对。
- `dev/data` 目录 0700 / 文件 0600（start 后收紧）；磁盘卷加密状态由 protection-report 如实报告
  （FileVault Off 即 D01.a BLOCKED，待 Owner 开启，脚本不推断为已保护）。
- 只使用合成数据与合成 key（`VC_ST_MOCK_EXPECT_KEY`，默认 `vc03-synthetic-key`）；禁止真实私人数据、
  真实 provider 凭据或正式 Key 进入 `dev/`、日志与任何提交物。
- Tavern Helper 为 PolyForm-Noncommercial：禁止商业使用，禁止向 Owner 以外的人提供本服务（ADR-0009 §3/§4）。
- 备份只打包显式保护清单（chats、group chats、groups、characters、worlds、backups、OpenAI Settings、
  user 资源、settings/secrets、cookie-secret、config.yaml），排除可确定性再生的自托管派生文件与
  `extensions/`；keyfile 不得位于 dataRoot 内、不得与归档同目录。
