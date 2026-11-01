# 2026-11-02 会话交接：uni-app 移动端 / 桌面体验优化

上一个会话（UX-10 审核 → UX-11 桌面沉浸玻璃 → UX-22 整改 → UX-23 聊天改版）上下文已过长，拆成两个新会话继续。
两个会话都先读第 1 节，再读各自的第 2 / 3 节。

## 1. 共用背景

### 1.1 代码与发布状态

- 工作分支 `ux-11-desktop-immersive`，最新提交 `362b145b`（已推送，**未合并 main**）。生产仍是 UX-21 部署的 `ff5b0514`。
- 分支上累计未部署：UX-22 全部整改、QA 修复、UX-23 聊天改版。部署由 Owner 指示 Codex 执行（指令模板见上一会话末尾：同一提交跑全量 `check.sh` + 受管场景整组后 `ops/deploy/v2/deploy.sh <commit>`，从该分支发布、不合并 main）。
- 分支规则：该分支上的提交不得挑拣或部分合并到 main（UX-11 方案 §2 末尾）。

### 1.2 必读文档（按需读，不必全读）

| 内容 | 位置 |
|---|---|
| 设计规范（桌面以第 16 节为准，手机按前文） | `DESIGN.md` |
| 桌面改版方案与 Owner 决定 D1–D15 | `docs/planning/2026-11-01-ux11-desktop-immersive-plan.md` |
| UX-22 整改单与执行结果 | `docs/planning/2026-11-01-ux22-desktop-remediation.md` |
| UX-23 聊天改版规格（决定 C-1–C-6） | `docs/planning/2026-11-02-ux23-chat-redesign.md` |
| 面向用户的文案（改文案先改这里） | `docs/planning/2026-10-30-companion-copy.md` |
| 拟人陪伴设计（MaiBot、EchoText、AIcove、eidolon-sc 等调研结论） | `docs/planning/2026-10-30-companion-humanlike-design.md` |
| 移动 App 现行决策（**将被移动端会话修订**） | `docs/decisions/0010-mobile-app-webview-shell.md` |
| 聊天界面开源调研（EchoText / eidolon-sc / AIcove；Liyuan / TauriTavern / dsh-tavern） | `.review-queue/UX-23/research-A.md`、`research-B.md`（Git 忽略，仅本机） |
| 全面功能 / UI 测试报告（27 项，聊天外已修，聊天项已并入 UX-23） | `.review-queue/UX-22/QA/REPORT.md` |
| 设计图与选择 | `.review-queue/UX-11/images/PICKS.md`（B 全站）、`.review-queue/UX-23/images/C1-1.png`（聊天主参照） |

### 1.3 Owner 的工作方式（已确认，直接照做）

- **先出图再开发**：界面工作先写出图提示词（公共风格块 + 页面块，固定合成内容），用 Codex CLI 生成：
  `codex exec --json -m gpt-6.1-sol -s workspace-write -C <仓库> --skip-git-repo-check "<指令+提示词>"`，
  **必须关闭标准输入**（Python `stdin=subprocess.DEVNULL`，否则会卡在 “Reading additional input from stdin”）；可并行，单张约 1–3 分钟，
  生成物在 `~/.codex/generated_images/`，由 Codex 复制到目标路径。Owner 挑选后再把图翻译成规范数值。
- **问答定方案**：取舍用选择题问 Owner，Claude 负责设计判断与规范；实现可交给 Sonnet 子代理（按文件划分归属、并行、不提交），Claude 整合、复核截图、提交。
- **遇到明确缺陷直接修，不用问**；只有产品取舍才问。
- **真实环境实测**：除受管场景（假模型）外，每轮在 Owner 的本地真实环境里用真实模型走一遍（见 1.4）。「发送没反应」等问题只在真实环境暴露。
- **不部署**：本地全部改好测好后，Owner 再让 Codex 一次性部署。
- 视觉验收不交给 Codex；仓库公开，不写服务器地址与凭据。

### 1.4 本地真实环境

- 本地生产镜像栈 `vc-local-dev`：`bash scripts/local/dev.sh up|rebuild <st|runtime|all>|status`。ST 容器**直接挂载仓库扩展目录**，前端改动刷新浏览器即生效；Go / ST 插件改动需 `rebuild`。
- 本机入口 `http://127.0.0.1:11080/`。内网访问（Owner 用本机内网 IP 的 11080 端口）需要三处本地配置（都在 `~/.virtual-companion-local/`，不进仓库）：
  1. `runtime.env` 的 `VC_HTTP_ORIGINS` 追加内网来源（已加，`init_secrets` 不会覆盖）；
  2. `config.yaml` 的 `hostWhitelist.hosts` 追加内网 IP 与 `IP:11080`（**每次 `dev.sh up/rebuild` 会重写，需重新追加并 `docker restart vc-local-dev-st-1`**）；
  3. 运行 `nohup python3 ~/.virtual-companion-local/lan-forward.py &`（内网 IP:11080 → 127.0.0.1:11080，重启电脑后需重开）。
- 用 Owner 的登录态实测：用 Playwright 启动带调试端口的有界面 Chromium（`launchPersistentContext(profileDir,{headless:false,args:['--remote-debugging-port=9333']})`），
  Owner 在窗口里登录一次，之后脚本 `chromium.connectOverCDP('http://127.0.0.1:9333')` 接管。playwright-core 在 `integrations/sillytavern/node_modules`。
  实测会在 Owner 会话里发消息，内容统一以「测试：」开头。
- 受管验收：`node integrations/sillytavern/scripts/accept-managed.mjs --filter <场景>`（同一时间只能跑一个；`f3-settings` 需与 `ui03-browser,voice-settings` 同轮跑，单独跑会被首次引导挡住，既有问题）。

### 1.5 已知遗留（未处理）

- 样板 `check.mjs` 的 components / model / voice 手机像素在原生 `select` 箭头处与基线不一致（环境相关，HEAD 同样复现）；真实宿主手机走查通过。
- 酒馆抽屉中「标题在控件上方」的宿主写法（API 连接、提示词格式、界面）未纳入标签列；页内标题行操作未并入标题栏；世界书 / 人设 / 角色卡双栏页未收窄。
- 对话标题栏副标题显示「名字 · 实例」（需改 `shell.js`）；麦克风随输入状态隐藏（需改 `voice-input.js`）。
- 真实宿主默认 ST 头像为「？」剪影，首字占位不覆盖。
- UX-11 深色设计图未补，深色数值按实测调整。

## 2. 会话一：uni-app 移动端（H5 + iOS + Android）

### 2.1 目标

Owner 决定移动端改用 uni-app 独立开发（H5，同时出 iOS / Android），不再让桌面网页兼容手机；桌面继续是 SillyTavern 网页宿主 + 沉浸玻璃。

### 2.2 第一件事：定架构（需要新 ADR 替代 ADR-0010）

关键约束：聊天提示词组装在 ST 前端完成，角色卡脚本（Tavern Helper / EJS / MVU）依赖浏览器 DOM；uni-app 原生页面无法运行它们。候选路线：

| 路线 | 做法 | 代价 |
|---|---|---|
| A 全原生 | uni-app 直连 Go；聊天由 Go 组装提示词并生成（Go 原有生成链路，`specs/catalog/go-v1-api-scope.yaml`） | 手机无角色卡脚本；Go 需补聊天接口与提示词组装 |
| B 混合 | 聊天页 web-view 嵌 ST 手机网页，其余页面 uni-app 原生 | 聊天体验受网页限制；改动最小 |
| C 先 A 后补 | 先做纯陪伴聊天，需卡片脚本时跳 web-view | 两套聊天并存 |

先用问答确认：手机上是否需要角色卡脚本与剧情；是否接受两套聊天；推送 / 后台 / 语音的优先级。然后写 ADR-0011（替代 ADR-0010），再出移动端设计图（沿用 UX-11 B 风格与 C5 手机参照），再拆任务。

### 2.3 约束

- ADR-0009 §3、§4：Tavern Helper 为 PolyForm Noncommercial，禁止商业使用与向 Owner 以外的人提供服务。
- 旧 Vue / uni-app 前端已在 W15 删除，可从 Git 历史参考，不要直接恢复。
- 接口变化先改 OpenAPI / catalog（`specs/generated/**` 用工具生成），迁移从当前最大版本顺延；TTS / ASR 只能经 Go。
- 不新增服务器暴露面；新增生产依赖需说明并确认（ADR-0009 已授权 V2 工作项内的依赖，移动端是否算 V2 工作项需在 ADR 里写明）。

## 3. 会话二：桌面体验优化（参考开源项目）

### 3.1 目标

Owner 认为细节、UI 与功能性仍有差距，希望更多借鉴之前调研的开源项目（EchoText、eidolon-sc、AIcove、Liyuan、TauriTavern、dsh-tavern、MaiBot、KouriChat、AstrBot、dafeiyu / raise-an-ai / whale-companion / yangyu-bot 等）以及微信、Telegram、iMessage 等主流聊天软件。

### 3.2 建议起点（Claude 上一会话整理，待 Owner 选择）

- 聊天：桌面启用分段气泡逐条出现；长回复落地定位到首行；向上加载历史锚定不跳；停止保留半截；输入框上方建议回复 chips；纯 emoji 放大为贴纸；语音条波形 + 时长 + 转文字折叠；跳到未读。
- 陪伴感：角色状态卡（心情、最近在做什么，参考 eidolon-sc）；主动消息通知横幅；记忆时间线。
- 质感：页面间共享元素过渡；空状态 / 骨架统一；声音与触感（手机）。
- 流程：每轮真实环境实测真实模型。

### 3.3 建议流程

调研（必要时再派子代理读具体项目源码，报告补进 `.review-queue/UX-24/`）→ 问答选范围 → 出图 → 规格文档 → 子代理实现 → 受管场景 + 真实环境实测 → 提交 → Owner 试用 → Codex 部署。
新条目在 `docs/planning/2026-10-31-handoff-backlog.md` 末尾追加 ID（建议 UX-24 起），进度回填 `TODO.md`。

## 4. 新会话开场指令（直接粘贴）

会话一：

```text
读 docs/planning/2026-11-02-session-handoff.md 第 1、2 节，接手 uni-app 移动端（H5 + iOS + Android）。
先不要写代码：用选择题问我第 2.2 节的架构取舍，定下来后写 ADR-0011，再按「先出图再开发」写移动端出图提示词。
```

会话二：

```text
读 docs/planning/2026-11-02-session-handoff.md 第 1、3 节，接手桌面体验优化。
先结合 .review-queue/UX-23/research-A.md、research-B.md 和需要时的补充调研，列出可做的优化清单并用选择题问我范围，
然后按「先出图再开发」推进；遇到明确缺陷直接修，每轮在我的本地真实环境实测。
```
