# 电脑端前端重建（DR2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本项目的执行约定（优先于上句）：** 调度者 Claude 把单个任务交给 Gemini 4（`agy`，见第 0 节），每个任务一个独立 worktree、一个写入者；
> Gemini 完成任务内全部步骤并提交后，Claude 审 diff、跑任务的验证命令、合入 `desktop-react-rebuild`。Owner 也可直接让 Gemini 按本计划逐项执行。

**Goal:** 把电脑端（`/`、`/desktop/`）重建为单一 React 应用：一套断点、开源组件优先、引擎行为不变，并修复审计核实的缺陷。

**Architecture:** `desktop-ui` 从"库模式 + 40 个 `mount*View` 被旧 JS 调用"改为"应用模式单入口"。React 拥有全部电脑端 DOM；聊天会话由 `standalone/session.js` 提供订阅 + 命令接口，复杂卡由 `standalone/cards/` 挂入 React 提供的叶子节点；旧原生 JS 页面只留给手机 `/native/`。

**Tech Stack:** React 19.3、TypeScript 5.9、Vite 8、Base UI 1.9、TanStack Query 5 / Router 1、react-hook-form + zod、zustand 5、cmdk、emoji-mart、wavesurfer.js 8、yet-another-react-lightbox、@dnd-kit、@monaco-editor/react、Vitest + Testing Library。

**Spec:** `docs/superpowers/specs/2026-11-04-desktop-react-rebuild-design.md`（每个任务开始前读第 2、4、6、9、10 节）

## 0. 执行方式（调度者用；Owner 自行让 Gemini 执行时照此）

### 0.0 调度交接（2026-11-04，Claude → Codex）

- **调度与决策者**：Codex CLI（`gpt-6.1-sol`，max 推理）。职责：按并行图派任务给 Gemini、审 diff、跑任务验证命令、合入
  `desktop-react-rebuild`、处理 Gemini 卡住或越界的情况、需要后端改动时自己按设计第 7 节契约先行完成。
- **前端执行者**：Gemini 4 Argon High（`agy`），每任务一个 worktree，提示词模板见下方 0.1。
- **视觉验收**：Codex 只做 `dr2-layout` 几何断言与截图产出；**外观终审留给 Claude**（Owner 规定视觉验收不交给
  codex/grok 类执行者）。T12 由 Codex 产出截图矩阵与 `NOTES.md` 后暂停，等 Claude 终审。
- **Claude 回来后做**：整体审计（`desktop-react-rebuild` 对 `codex/desktop-independent-frontend` 全量 diff）+ T12 视觉终审。
- **交接时状态**：设计与计划已提交（`77b3b22f`）；T1 已派 Gemini，在 `/Users/hxf/projects/vc-dr2-t1`（分支 `dr2/t1`）运行，
  日志 `/tmp/vc-dr2-t1.log`。Codex 接手第一步是检查 T1 结果（第 0.2 节）。
- **参考材料**（已忽略不提交，仅本机）：`.review-queue/DR2/handoff/`
  - `recon/R1–R4`：功能清单与模块分类、token/CSS 表、引擎与上游差异及 Helper 缺口、测试与场景 DOM 钩子。派任务时把相关文件
    路径写进 Gemini 提示词（T3 → R2；T5–T10 → R1 对应章节；T11 → R4；T14/T15 → R3）。
  - `audit/`：审计时 Gemini 四份报告（大量误报，以设计第 9 节"已核实"清单为准）；`audit-mvu-empty.mjs` 是 B1 实测场景，T11 的
    `dr2-mvu-new` 以它为起点。
  - **注意**：R2 的 `tokens.css` 初稿数值有错（例如 accent 写成 `#c96a4a`），T3 必须以 DESIGN.md 与 `desktop/themes/aurora.css`
    实际值为准，R2 只用其"缺失 / 冲突 / 重复变量"清单。

### 0.1 Gemini 任务提示词模板（`<N>` 为任务号）

```text
你是本仓库的前端执行者。读 AGENTS.md、docs/superpowers/specs/2026-11-04-desktop-react-rebuild-design.md、
docs/superpowers/plans/2026-11-04-desktop-react-rebuild.md 的第 0–3 节与「Task <N>」。另读参考：<相关 .review-queue/DR2/handoff 文件>。
只做 Task <N>，按其步骤逐项完成（先写失败测试并确认失败，再实现，再跑任务的全部验证命令），全部通过后按任务里的提交信息
提交到当前分支（dr2/t<N>）。提交信息末尾加一行：Co-Authored-By: Gemini 4 <noreply@google.com>
约束：
- 不得修改该任务 Files 列表之外的文件；确需修改时停下，在输出里说明原因与文件。
- 不得删除测试、加 skip、削弱断言；设计第 10.1 节授权随旧电脑端模块删除的测试除外，提交信息写"依 Owner 2026-11-04 授权随旧模块删除"。
- 新增 npm 依赖用 npm install --prefix integrations/sillytavern [-D] <pkg>@<exact-version> --save-exact，并在
  scripts/checks/license-inventory.yaml 的 integrationDirectDependencies 登记。
- 不推送；受管场景只在任务步骤要求时运行，且使用调度者给的端口与容器名：<端口/容器变量>；运行后删除 dev-managed/。
- 原生桥产物 extension/vc-model-settings/desktop/build/index.js 的 38 个导出必须保持不变；/native/ 相关单测必须继续通过。
- 日志、截图、提交中不得出现对话正文或凭据。
完成后输出：改动文件列表、执行过的命令及其结果（PASS/FAIL 与关键行）、未解决问题。
```

调用：`cd <worktree> && /Users/hxf/.local/bin/agy -p "$(cat <prompt>)" --model gemini-4-argon-high --dangerously-skip-permissions --print-timeout 0 > /tmp/vc-dr2-t<N>.log 2>&1`

### 0.2 每个任务的合入检查（调度者）

1. `git -C <worktree> log --oneline desktop-react-rebuild..HEAD` 有且只有该任务的提交；`git diff desktop-react-rebuild...HEAD --stat` 只含任务 Files（另允许 `package*.json`、`license-inventory.yaml`）。
2. diff 里没有：`!important`（允许的两类除外）、组件读 `innerWidth`/`matchMedia`（`useChrome.ts`/`useReducedMotion.ts` 除外）、删测试 / `skip` / 弱化断言（授权删除除外）、对 `bridge/` 的行为改动。
3. 在 worktree 里重跑任务 Step 4 的验证命令，结果与 Gemini 报告一致。
4. `git -C /Users/hxf/projects/virtual-companion-desktop-rebuild merge --ff-only dr2/t<N>`（不能快进时先让 Gemini 在其分支 rebase）；合入后删 worktree 与分支。
5. Gemini 两次未通过同一验证：Codex 读日志定位根因，给出具体修正指令重派一次；仍失败则 Codex 自己修，并在提交信息注明。
6. 每合入一个任务，在 `TODO.md`「陪伴体验后续」追加一行 `DR2-<N>`：提交号、验证结果、是否有遗留。

### 0.3 worktree 准备

```bash
# 每个任务一个 worktree，基于最新 desktop-react-rebuild
git -C /Users/hxf/projects/virtual-companion-desktop-rebuild worktree add -b dr2/<task-id> \
  /Users/hxf/projects/vc-dr2-<task-id> desktop-react-rebuild
C=/Users/hxf/.codex/worktrees/desktop-independent-frontend/virtual-companion/integrations/sillytavern
ln -sfn $C/upstream /Users/hxf/projects/vc-dr2-<task-id>/integrations/sillytavern/upstream
cp -a /Users/hxf/.codex/worktrees/desktop-frontend-refactor/virtual-companion/integrations/sillytavern/dev \
  /Users/hxf/projects/vc-dr2-<task-id>/integrations/sillytavern/dev          # 含 vendor-cache 与 bootstrap-ok
npm ci --prefix /Users/hxf/projects/vc-dr2-<task-id>/integrations/sillytavern --include=dev --no-audit --no-fund

cd /Users/hxf/projects/vc-dr2-<task-id>
/Users/hxf/.local/bin/agy -p "$(cat <<'EOF'
你是本仓库的前端执行者。读 AGENTS.md、docs/superpowers/specs/2026-11-04-desktop-react-rebuild-design.md、
docs/superpowers/plans/2026-11-04-desktop-react-rebuild.md 的第 0–3 节与「Task <task-id>」。
只做该任务，按其步骤逐项完成（先写失败测试、再实现、再跑验证），全部通过后按任务里的提交信息提交到当前分支。
不得修改该任务 Files 列表之外的文件（确需修改时停下，在输出里说明原因）。不得删除测试、加 skip、削弱断言，
第 10.1 节授权随旧模块删除的测试除外。完成后输出：改动文件列表、执行过的命令及结果、未解决问题。
EOF
)" --model gemini-4-argon-high --dangerously-skip-permissions --print-timeout 0
```

- **受管场景端口**：并行任务各用一组端口与容器名，避免冲突：`VC_W03_ST_PORT=87<n>2 VC_W03_FIXTURE_PORT=87<n>3 VC_W03_GO_PORT=81<n>5
  VC_MEMORYCORE_PORT=87<n>4 VC_W03_PG_CONTAINER=vc-w03-dr2-<n>-pg VC_W03_MINIO_CONTAINER=vc-w03-dr2-<n>-minio
  VC_W03_DEV_DIR=$PWD/integrations/sillytavern/dev-managed VC_W03_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`，
  `<n>` 为 worktree 序号 1–6。任务结束后删除 `dev-managed/` 与 worktree（OP-11）。
- **合入前检查**：见 0.2。
- **并行图**（同一行可并行；箭头表示依赖）：

```
T1 ─► T2 ─► T3 ─┬─► T4 ─► T5 ─┐
                ├─► T6 ───────┤
                ├─► T7 ───────┤
                ├─► T8 ───────┼─► T11 ─► T12 ─► T13
                ├─► T9 ───────┤
                └─► T10 ──────┘
T14（引擎删减）→ T15（Helper 接口补齐）在 T5 之后串行（同一写入 owner：standalone/engine、cards），与 T6–T10 并行
T5 的 B2 只补 setLorebookSettings 一个函数；T15 批 2 视其已存在，跳过
```

## Global Constraints

- Node `>=22.13`；Go 不在本计划范围（若需后端，按设计第 7 节交 Codex `gpt-6.1-sol` max，契约先行）。
- React `19.3.1`、react-dom `19.3.1`、`@base-ui/react` `1.9.0` 保持不变；新依赖取 npm 当前稳定版，锁进 `integrations/sillytavern/package-lock.json`，并在 `scripts/checks/license-inventory.yaml` 的 `integrationDirectDependencies` 登记（`scope: runtime` 或 `dev`）。
- 断点只有三个：`744px`、`1180px`、`1600px`。`<html>` 上 `data-chrome="narrow|compact|regular|wide"` 对应 `<744 / 744–1179 / 1180–1599 / ≥1600`。只有 `src/shell/useChrome.ts` 可以读视口宽度；组件尺寸适配用 `@container`。
- CSS：`@layer reset, tokens, base, components, features, utilities;`；禁止 `!important`，例外仅限：`[hidden]{display:none!important}` 一处与 `prefers-reduced-motion` 下停止无限动画（需注释）。
- 视觉真源：DESIGN.md 有数值处以 DESIGN.md 为准；否则以 `codex/desktop-independent-frontend@3131d92b` 当前实现为准；深色以当前实现为准。桌面 `--vc-ink-2` 浅 `#55555a` / 深 `#b2b2b7`；正文 `--vc-fs-body: calc(15px * var(--fontScale, 1))`。
- 文案：只用 `docs/planning/2026-10-30-companion-copy.md` 与当前实现已有文案；不新增次级标签和说明文字（DESIGN.md 与全局规则）。
- 宿主 DOM 契约（设计第 6 节，卡片与受管场景依赖，必须原样渲染）：`#chat`、`#chat > .mes[mesid][is_user]`、`.mes_text`、`#send_textarea`、`#send_but`、`#mes_stop`、楼层 iframe id `TH-message--<mesid>--<n>`、脚本 iframe id `TH-script--*`、`html[data-vc-app="ready"]`、`html[data-vc-runtime="prepared|error"]`、`html[data-vc-theme]`、`[data-convo-list] [data-relationship-id]`（选中加 `aria-current="true"`）、`window.SillyTavern.getContext()`。
- 测试：Owner 2026-11-04 授权"用不到就删"——只测试被删除电脑端旧 UI 模块的测试随模块同一提交删除；引擎、会话、F2/CAS、复杂卡、提示词等价、`/native/`、手机相关测试不得删除或削弱。删除测试的提交信息写"依 Owner 2026-11-04 授权随旧模块删除"。
- `/native/` 仍依赖 `extension/vc-model-settings/desktop/build/index.js` 的 38 个 `mount*View` 导出（19 个原生模块与 28 个原生单测静态 import）。该库产物**保留**，改名为"原生桥"构建；电脑端应用另行构建，二者互不 import。
- 日志、截图、提交中不得出现对话正文或凭据；截图用合成账号与合成数据。

## Review Focus

1. **窗口在断点附近拖动**（743↔744、1179↔1180、1599↔1600）：布局只切换一次、不闪烁、打开中的浮层跟随锚点或关闭，草稿与滚动位置不丢 —— 测试加在 T4（`useChrome` 抖动测试）与 T11（`dr2-layout` 拖动断言）。
2. **生成中切换会话 / 打开设置 / 刷新页面**：旧会话流式结果不写入新会话，离开保护先于未保存草稿丢失触发，F2 草稿可恢复 —— 测试加在 T5（会话桥）与 T11（`nf-chat` 回归）。
3. **复杂卡楼层在 React 重渲染时保持身份**：输入、流式、主题切换、侧栏收起时楼层 iframe 不重建（同一 `contentWindow`）—— 测试加在 T5（`MessageLeaf` 不重挂载测试）。
4. **深色 + 减少透明度 + 减弱动效同时开启**：玻璃层变不透明、极光静止降到 `.20`、文字对比 ≥4.5:1 —— 测试加在 T3（token 测试）与 T12（截图矩阵）。
5. **长内容**：超长角色名 / 会话预览 / 记忆摘要 / 世界书条目名不撑破列宽、不造成横向滚动 —— 测试加在 T11（`dr2-layout` 用超长合成数据）。

---

## 1. 文件结构（重建后）

```
integrations/sillytavern/desktop-ui/
  index.html                       # T1 应用入口模板（Vite 应用模式）
  vite.config.mjs                  # T1 两个构建：app（电脑端）+ bridge（原生桥库模式）
  vitest.config.mjs                # T1
  src/
    bridge/index.tsx               # T1 由原 src/index.tsx 改名，仅供 /native/；内容不变
    app/main.tsx                   # T1 入口：Provider、Router、ErrorBoundary
    app/router.tsx                 # T4 路由表
    app/providers.tsx              # T2 QueryClient、主题、偏好 store
    data/client.ts                 # T2 包装 standalone/client.js 与 api.js
    data/queries/*.ts              # T6–T10 各业务 query/mutation 钩子
    design/tokens.css              # T3
    design/base.css                # T3 @layer 定义与 reset/base
    design/components/*.tsx        # T3 Base UI 皮肤组件
    shell/useChrome.ts             # T4 唯一视口读取点
    shell/AppShell.tsx             # T4 网格布局、侧栏、浮层宿主、极光
    shell/Aurora.tsx               # T4
    runtime/session-bridge.ts      # T5 订阅 + 命令
    features/chat/*                # T5
    features/characters/*          # T6
    features/memory/*              # T7
    features/inbox/*               # T7
    features/story/*               # T8
    features/settings/*            # T9
    features/tavern/*              # T10
  tests/**/*.test.tsx              # Vitest
integrations/sillytavern/server-plugin/virtual-companion/desktop/index.html  # T1 由构建产出覆盖
integrations/sillytavern/scripts/build-desktop.mjs                          # T1 跑两个构建
integrations/sillytavern/scripts/desktop-rebuild-accept.mjs                 # T11 dr2-* 受管场景
integrations/sillytavern/tests/desktop-import-boundary.test.mjs             # T2 白名单强制
```

纯逻辑拆分（原地，手机端继续用；新文件只含纯函数，原文件改为从新文件 import 再导出）：

| 新文件（`extension/vc-model-settings/` 下） | 来源 | 由谁拆 |
| --- | --- | --- |
| `chat-logic.js` | `chat-compose.js:14-152`、`chat-view.js:119-267,302-306`、`chat-motion.js:5-46`、`chat-scroll.js:6-24,52-128`、`chat-react.js:10-203`、`chat-search.js:5-53` | T5 |
| `voice-logic.js` | `voice.js:5-119`、`voice-chat.js:4-190`、`voice-input.js:4-32`、`voice-settings.js:10-32` | T5 |
| `stickers-logic.js` | `stickers.js:11-343,489-535,688-733` | T5 |
| `f2-logic.js` | `f2-client.js:9-207,231-236,558-607` | T2 |
| `instance-logic.js` | `instance-page.js:16-166,211-411,495-564`、`persona.js:6-123` | T6 |
| `memory-logic.js` | `memory-controller.js:32-177`、`memory-page.js:19-27,125-255,538-644`、`diary-page.js:5-55,69-98`、`message-source.js:8-54` | T7 |
| `inbox-logic.js` | `inbox-page.js:28-170,201-364,366-775,884-904`、`chat-shell.js:26-44,66-69`、`desktop/notify.js:5-55` | T7 |
| `story-logic.js` | `story-page.js:42-600,707-776` | T8 |
| `consent-logic.js` | `consent.js:8-102`、`data-rights.js:17-45,57-73` | T9 |
| `theme-logic.js` | `ui/theme.js:5-56,66-73`、`desktop/theme.js:3-46`、`desktop/aurora.js:2-16` | T3 |
| `status-logic.js` | `desktop/status-card.js:9-104`、`desktop/suggest.js:7-53` | T5 |
| `projection-logic.js` | `projection.js:13-410` | T2 |
| `desktop/tavern-controller.js` | `desktop/tavern-settings.js:24-585` 去掉 DOM 挂载 | T10 |

行号来自 2026-11-04 摸底，执行时以实际函数边界为准；**拆分只移动代码，不改逻辑**，原文件对外导出保持不变（`/native/` 与其单测零改动）。

## 2. 白名单（T2 产出，`tests/desktop-import-boundary.test.mjs` 强制）

`desktop-ui/src/**`（`bridge/` 除外）只允许 import 下列扩展模块：

```
desktop/standalone/**（含 engine/**、cards/**、client.js、business.js、personas.js、input-markdown.js、runtime.js、session.js）
settings-documents.js  desktop/tavern-defaults.js  desktop/tavern-fields.js  desktop/themes/index.js
api.js  inbox-client.js  account-logic.js  model-logic.js  conversations.js  instance-queries.js
companion-prompt.js  companion-tools.js  user-expressions.js  prompt-history.js  reply-pipeline.js  reply-planner.js
story-action.js  story-context.js  story-projection.js  projection-save.js  ui/icons.js  ui/tint.js
以及第 1 节表中全部 *-logic.js 与 desktop/tavern-controller.js
```

## 3. 统一验证命令

| 名称 | 命令 | 通过标志 |
| --- | --- | --- |
| 类型 | `npm --prefix integrations/sillytavern run check:desktop` | 退出码 0 |
| 组件测试 | `npm --prefix integrations/sillytavern run test:desktop` | `Tests  N passed`，0 failed |
| 离线单测 | `node --test "integrations/sillytavern/tests/*.test.mjs"` | `# fail 0` |
| 全量 | `bash scripts/check.sh` | `OK    scripts/check.sh 全部通过` |
| 受管 | `node integrations/sillytavern/scripts/accept-managed.mjs --filter <ids>`（带第 0 节环境变量） | `✓ 全部 N 个所选场景通过` |

---

### Task 1: 应用模式构建与原生桥分离

**Files:**
- Move: `integrations/sillytavern/desktop-ui/src/index.tsx` → `integrations/sillytavern/desktop-ui/src/bridge/index.tsx`（内容不变，只改相对 import 路径）
- Create: `integrations/sillytavern/desktop-ui/index.html`、`src/app/main.tsx`、`vitest.config.mjs`、`tests/app/main.test.tsx`
- Modify: `integrations/sillytavern/desktop-ui/vite.config.mjs`、`integrations/sillytavern/scripts/build-desktop.mjs`、`integrations/sillytavern/package.json`、`integrations/sillytavern/server-plugin/virtual-companion/lib/host-auth.js:60-65,96-100,150-154`、`.gitignore`
- Test: `integrations/sillytavern/tests/host-auth.test.mjs`（追加用例）

**Interfaces:**
- Produces: 构建产物 `extension/vc-model-settings/desktop/build/index.js`（原生桥，导出不变）；`server-plugin/virtual-companion/desktop/app/index.html` 与 `desktop/app/assets/*.{js,css}`（电脑端）；`host-auth.js` 对 `GET /` 与 `GET /desktop/` 返回 `desktop/app/index.html` 并注入 meta，对 `GET /desktop/assets/*` 返回静态资源（`Cache-Control: private, max-age=31536000, immutable`，`X-Content-Type-Options: nosniff`）。
- Produces: `npm run test:desktop` 脚本（`vitest run --config desktop-ui/vitest.config.mjs`）。

- [ ] **Step 1: 写失败测试** —— `tests/host-auth.test.mjs` 新增 `serves built desktop app shell with identity meta` 与 `serves hashed desktop assets immutable and rejects traversal`：

```js
// 用既有 createHostAuth 测试夹具；desktopAppDir 指向临时目录，内含 index.html 与 assets/app-abc.js
assert.equal(res.statusCode, 200);
assert.match(body, /<meta name="vc-account-id" content="1">/);
assert.match(body, /<script type="module" src="\/desktop\/assets\/app-abc\.js">/);
// assets
assert.equal(assetRes.headers['cache-control'], 'private, max-age=31536000, immutable');
assert.equal(traversalRes.statusCode, 404); // /desktop/assets/../index.html
```

`tests/app/main.test.tsx`：`renders startup status then app root` —— 渲染 `<App />` 后存在 `role="status"` 文本"正在打开聊天…"或 `[data-vc-app]`。

- [ ] **Step 2: 运行确认失败** —— `node --test integrations/sillytavern/tests/host-auth.test.mjs`，预期新用例 FAIL；`npm --prefix integrations/sillytavern run test:desktop` 预期 "Missing script"。

- [ ] **Step 3: 实现**
  - `vite.config.mjs` 导出两个配置：`bridge`（原 lib 配置，入口改 `src/bridge/index.tsx`，输出不变）与 `app`（`root: desktop-ui`、`base: '/desktop/'`、`build.outDir: ../server-plugin/virtual-companion/desktop/app`、`emptyOutDir: true`、`build.assetsDir: 'assets'`）。用环境变量 `VC_DESKTOP_TARGET=bridge|app` 选择。
  - `build-desktop.mjs` 依次构建 `bridge` 与 `app`，两次产物的打包依赖许可合并写入各自目录的 `THIRD_PARTY_NOTICES.txt`。
  - `host-auth.js`：`desktopHtml` 默认读 `../desktop/app/index.html`；新增 `serveDesktopAsset(desktopAppDir, req, res)`，复用 `serveMobile` 的路径校验写法；`/desktop/assets/` 在认证通过后分发。
  - 删除旧 `server-plugin/virtual-companion/desktop/index.html`（由构建产出替代），`.gitignore` 加 `integrations/sillytavern/server-plugin/virtual-companion/desktop/app/`。
  - `src/app/main.tsx` 暂时只渲染启动文案与 `document.documentElement.dataset.vcApp = 'booting'`。
  - `package.json` 增 devDeps `vitest`、`@testing-library/react`、`@testing-library/user-event`，脚本 `test:desktop`；`license-inventory.yaml` 登记。

- [ ] **Step 4: 验证** —— 类型、组件测试、`node --test integrations/sillytavern/tests/host-auth.test.mjs` 全 PASS；`node integrations/sillytavern/scripts/build-desktop.mjs` 后 `ls integrations/sillytavern/server-plugin/virtual-companion/desktop/app/assets` 有 `.js` 与 `.css`；`node --test "integrations/sillytavern/tests/*.test.mjs"` `# fail 0`（原生桥未变）。

- [ ] **Step 5: 提交** —— `git commit -m "build(DR2-1): 电脑端改为应用模式构建并保留原生桥"`

> 说明：T1 完成后电脑端暂时只显示启动文案，`nf-*` 场景会失败；这是预期的中间态，T11 前不要求通过。合入顺序保证 `desktop-react-rebuild` 不被部署。

### Task 2: 数据层、白名单与纯逻辑拆分（F2 / 投影）

**Files:**
- Create: `desktop-ui/src/app/providers.tsx`、`src/data/client.ts`、`src/data/queryKeys.ts`、`extension/vc-model-settings/f2-logic.js`、`extension/vc-model-settings/projection-logic.js`、`tests/desktop-import-boundary.test.mjs`、`desktop-ui/tests/data/client.test.ts`
- Modify: `extension/vc-model-settings/f2-client.js`、`projection.js`（改为从 `*-logic.js` import 并 re-export）、`package.json`、`license-inventory.yaml`

**Interfaces:**
- Produces: `createAppClient(): AppClient`（`src/data/client.ts`），其中 `AppClient = ReturnType<typeof createDesktopClient> & { go: typeof import('api.js') }`；`queryClient`（`retry: 1`，`staleTime: 30_000`，`refetchOnWindowFocus: false`）；`AppProviders({children})`；`queryKeys` 常量（`relationships`、`characters`、`recentChats`、`memory(relId, filters)`、`inbox(filter)`、`providers`、`purposes`、`settingsDoc`、`voiceSettings`、`storyRuns`…）。
- Produces: `f2-logic.js` 导出 `F2ConflictError, characterChatPath, groupChatPath, createF2Client, extractUnsavedUserInput, mergeInput, createSourceGuard`；`projection-logic.js` 导出 `projection.js:13-410` 的全部纯函数（名称不变）。

- [ ] **Step 1: 写失败测试** —— `desktop-import-boundary.test.mjs`：用 esbuild metafile（`vite build` 的 `rollupOptions.output` 不够，改用 `es-module-lexer` 递归解析 `desktop-ui/src/app/main.tsx` 的 import 图），断言每个落在 `extension/vc-model-settings/` 的模块都在第 2 节白名单内；`client.test.ts`：`maps 409 to ConflictError with details`、`drops response of superseded identity`（身份 meta 变化后请求被拒）。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现** —— 拆分只移动代码；`AppProviders` 包 `QueryClientProvider`；`client.ts` 不复制请求逻辑，只组合 `createDesktopClient()` 与 `api.js`。
- [ ] **Step 4: 验证** —— 类型、组件测试、离线单测 `# fail 0`（`/native/` 相关单测零改动通过）。
- [ ] **Step 5: 提交** —— `git commit -m "feat(DR2-2): 电脑端数据层与模块白名单"`

### Task 3: 设计 token、分层 CSS 与基础组件

**Files:**
- Create: `desktop-ui/src/design/tokens.css`、`base.css`、`components/{Button,IconButton,Field,TextInput,Textarea,Select,Switch,Slider,Checkbox,Segment,Menu,Dialog,AlertDialog,Popover,Tooltip,Toast,ScrollArea,Tabs,Avatar,Icon,EmptyState,Spinner}.tsx`、`extension/vc-model-settings/theme-logic.js`、`desktop-ui/tests/design/*.test.tsx`
- Modify: `ui/theme.js`、`desktop/theme.js`、`desktop/aurora.js`（改为 import `theme-logic.js`）；删除 `desktop-ui/src/components/*` 中被新组件替代的文件（`Overlays.tsx`、`Segment.tsx`、`Switch.tsx`、`IconButton.tsx`、`Avatar.tsx`、`Icon.tsx`），`bridge/` 若仍引用则把它们移入 `src/bridge/components/` 原样保留

**Interfaces:**
- Produces: CSS 变量（名称沿用现有 `--vc-*`，值来自 DESIGN.md §4/§16 与 `desktop/themes/aurora.css`），并补齐摸底发现的缺失项：`--vc-placeholder`（浅 `#68686c` / 深 `#98989d`）、`--vc-lh-title-1`（=`--vc-lh-title`）；去除 `--vcms-*`、`--vc-poster-pad`、重复的 `--vc-z-*`/`--vc-read`/`--vc-spring`。
- Produces: 组件 props（每个组件 `className?` 透传，样式只读 token）：`Button({variant:'filled'|'gray'|'danger'|'text', size:'md', pending?:boolean, ...ButtonHTMLAttributes})` —— `pending` 时宽度锁定、前置 16px 旋转图标；`Dialog({open,onOpenChange,title,children,actions,width?:420|560|760})`；`AlertDialog({open,onOpenChange,title,description?,confirmLabel,cancelLabel,danger?,onConfirm})`；`Menu({trigger,items:{id,label,danger?,separator?,onSelect}[]})`；`Toast` 用 Base UI Toast，`toast.show({title, kind:'success'|'error'})`（成功 1.8s，失败常驻带关闭，同层单实例）。
- Produces: `theme-logic.js` 导出 `parseThemeMode, readThemeMode, writeThemeMode, readThemePreferences, setGlobalThemePreference, setCharacterThemePreference, resolveTheme, characterThemeKey, rotateHue, timeOfDayShift`（原函数移动）。

- [ ] **Step 1: 写失败测试** —— `tokens.test.tsx`：`dark + reduced transparency makes glass opaque`（在 `<html data-vc-theme="dark">` 与模拟 `prefers-reduced-transparency` 下读 `--vc-glass-2` 计算值为 `#1C1C20`）、`no !important outside allowed rules`（读取 `src/**/*.css` 文本，`!important` 只允许出现在 `[hidden]` 规则与带 `/* reduced-motion */` 注释的规则中）；`Button.test.tsx`：`pending keeps width and shows spinner`；`AlertDialog.test.tsx`：`Esc cancels and returns focus to trigger`；`Menu.test.tsx`：`arrow keys move, Esc closes, focus returns`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现** —— `base.css` 首行 `@layer reset, tokens, base, components, features, utilities;`；组件只做 Base UI 皮肤，样式写在同名 `.css`（`@layer components`）；数值严格按 DESIGN.md §9、§16.4、§16.5。
- [ ] **Step 4: 验证** —— 类型、组件测试、离线单测。
- [ ] **Step 5: 提交** —— `git commit -m "feat(DR2-3): 设计 token、分层样式与 Base UI 基础组件"`

### Task 4: 壳层、断点与路由

**Files:**
- Create: `desktop-ui/src/shell/{useChrome.ts,AppShell.tsx,AppShell.css,Sidebar.tsx,Aurora.tsx,Aurora.css,OverlayHost.tsx,useReducedMotion.ts,usePreferences.ts}`、`src/app/router.tsx`、`tests/shell/*.test.tsx`
- Modify: `src/app/main.tsx`、`package.json`（`@tanstack/react-router`、`zustand`、`cmdk`）、`license-inventory.yaml`

**Interfaces:**
- Produces: `useChrome(): 'narrow'|'compact'|'regular'|'wide'`（基于三个 `matchMedia('(min-width: Npx)')`，同步写 `<html data-chrome>`）；`usePreferences()`（zustand，持久化键沿用 `vc-theme`、`vc-reply-style`、`vc-reduced-motion`、`vc-desktop-theme`、`vc-sidebar-collapsed`）；路由：`/` → 重定向到 `/chat`；`/chat`、`/chat/$conversationKey`、`/characters`、`/characters/$avatar`、`/memory`、`/inbox`、`/story`、`/story/$runId`、`/settings/$category`、`/settings/tavern/$section`（基路径 `/desktop/` 与 `/` 都可进入，使用 hash history 以免服务端路由改动）；`useLeaveGuard(dirty: boolean, message?: string)`（基于 TanStack Router `useBlocker`，弹 `AlertDialog`："放弃未保存的修改？"——文案以 companion-copy 为准）；`<QuickSwitch>`（cmdk，⌘K / Ctrl+K）。
- 布局取值（DESIGN.md §11、§16.3）：窗口外边距 ≥1180 `24px`、744–1179 `16px`；面板间距 `12px`；侧栏 ≥1180 `200px`，744–1179 `72px`；会话列表 `320px`；对话最小 `560px`、阅读列最大 `720px`；角色面板 `340px`（≥1600 并排默认展开；1180–1599 默认收起，打开时会话列表让位；<1180 浮层且不遮标题栏与输入区）；`narrow` 档是压窄的桌面布局（Owner 2026-11-04）：侧栏 72px 图标栏、窗口外边距 `12px`；会话列表与对话二选一（进入会话后列表隐藏，标题栏左侧按钮返回列表）；角色面板与设置分类为浮层；Dialog 宽 `min(设定宽, 100vw - 32px)`。不实现底部标签栏、底部 sheet、拖拽档位、推入视差、键盘避让。

- [ ] **Step 1: 写失败测试** —— `useChrome.test.ts`：`maps 743/744/1179/1180/1599/1600 to correct chrome`、`writes data-chrome once per crossing`（模拟 matchMedia 连续触发同值不重复写）；`AppShell.test.tsx`：`compact hides list after entering conversation and list button reopens it`、`wide shows four columns with panel open by default`；`router.test.tsx`：`leave guard blocks navigation while dirty and proceeds after confirm`；`QuickSwitch.test.tsx`：`Ctrl+K opens, typing filters conversations, Enter navigates`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现** —— 壳层 CSS Grid `grid-template-columns` 由 `[data-chrome]` 选择器决定；`Aurora` 按 DESIGN.md §16.2（三光斑 `60vmax`、周期 40/52/64s、只动 transform、页面隐藏暂停、减弱动效静止降 `.20`、换角色 900ms 交叉淡化）；侧栏选中透镜、角标、底部头像 + 设置。
- [ ] **Step 4: 验证** —— 类型、组件测试。
- [ ] **Step 5: 提交** —— `git commit -m "feat(DR2-4): 壳层布局、统一断点、路由与离开保护"`

### Task 5: 聊天页与会话桥（含 B1–B6、B12、B13）

**Files:**
- Create: `desktop-ui/src/runtime/session-bridge.ts`、`src/features/chat/{ChatRoute.tsx,ConversationList.tsx,MessageList.tsx,MessageItem.tsx,MessageLeaf.tsx,Composer.tsx,MessageMenu.tsx,ReactionBar.tsx,EmojiPicker.tsx,VoiceBubble.tsx,VoiceRecorder.tsx,ChatSearch.tsx,CharacterPanel.tsx,StatusCard.tsx,ConflictSheet.tsx,useReadingPosition.ts,chat.css}`、`extension/vc-model-settings/{chat-logic.js,voice-logic.js,stickers-logic.js,status-logic.js}`、`desktop-ui/tests/chat/*.test.tsx`、`integrations/sillytavern/tests/desktop-session-fixes.test.mjs`
- Modify: `extension/vc-model-settings/desktop/standalone/session.js`（B1、B3、B4；`showToast` 改为 `onToast` 回调；`renderMessage` DOM 部分移出到 React）、`desktop/standalone/app.js`（删除，逻辑迁入 `ChatRoute` 与 `session-bridge`）、`desktop/standalone/cards/{index.js,predefine.js}`（B6）、`desktop/standalone/cards/helper-*.js`（B2：补 `setLorebookSettings`，与上游 JS-Slash-Runner 同名函数行为一致）、`desktop/standalone/runtime.js`（`online` 监听移出，改由 `session-bridge` 注册）、`chat-compose.js`、`chat-view.js`、`chat-motion.js`、`chat-scroll.js`、`chat-react.js`、`chat-search.js`、`voice*.js`、`stickers.js`、`desktop/status-card.js`、`desktop/suggest.js`（改为 import 新 `*-logic.js` 并 re-export）、`package.json`（`emoji-mart`、`@emoji-mart/react`、`@emoji-mart/data`、`wavesurfer.js`、`yet-another-react-lightbox`）

**Interfaces:**
- Consumes: T2 `createAppClient`；T3 组件；T4 `useLeaveGuard`、路由参数 `conversationKey`。
- Produces（`session-bridge.ts`）：

```ts
export type ChatSnapshot = { key: string; messages: readonly ChatMessage[]; busy: boolean; canSend: boolean;
  notice: string; conflict: boolean; catalogBlocked: boolean; settingsRequired: boolean; enterToSend: boolean;
  runtime: 'idle' | 'preparing' | 'prepared' | 'error' };
export function createSessionBridge(client: AppClient): SessionBridge;
export interface SessionBridge {
  subscribe(listener: () => void): () => void;  getSnapshot(): ChatSnapshot;        // 供 useSyncExternalStore
  open(row: ConversationRow, opts?: { latest?: boolean }): Promise<'opened' | 'superseded' | 'failed'>; // 激活完成才 resolve（B5）
  send(text: string, opts?: { type?: 'normal' | 'continue' }): Promise<boolean>;
  stop(): Promise<void>;  edit(index: number, text: string): Promise<boolean>;  remove(index: number): Promise<boolean>;
  swipe(index: number, delta: -1 | 1): Promise<boolean>;  react(index: number, emoji: string): Promise<boolean>;
  pat(): Promise<boolean>;  whenIdle(): Promise<void>;
  mountLeaf(index: number, host: HTMLElement): () => void;   // 交给 cards.renderMessage；返回卸载函数
  draft: { read(key: string): string; write(key: string, value: string): void };
}
export function useChatSnapshot(bridge: SessionBridge): ChatSnapshot;
```

- 缺陷修复要求：
  - **B1**：`session.js` `open()` 中先放入开场白（`firstMessage`）并发出 `CHAT_CHANGED`，再 `await engine.cards.open()`；`cards.open` 的 MVU 等待条件对"无消息"直接视为就绪。
  - **B2**：Helper 全局导出补齐 `setLorebookSettings`（及 T14 摸底列出的其他被 MVU/EJS 调用的缺口）。
  - **B3**：`save()` 记录发起时的脏版本号 `const version = ++dirtyVersion`，返回后仅当 `dirtyVersion === version` 才清 `metadataDirty`。
  - **B4**：自动续写判断在释放 `job` 之前完成；`GENERATION_ENDED` 在整个续写链结束后发出一次。
  - **B5**：`open()` 在 Session 激活完成后才 resolve；跳转原消息、侧栏选中、已读在 resolve 后执行。
  - **B6**：`predefine.js` 把 `_bind` 包装后的函数同时覆盖到 `window.TavernHelper.<fn>`；`assertFrame(frame)` 对 `null` 抛 `VC_STALE_CARD_RUNTIME`。
  - **B12/B13**：`MessageItem` 的 `key` 用消息稳定标识（`send_date` + 原始索引在打开时生成的 id，存于 Session 快照，不随删除变化）；`MessageLeaf` 只在 `key` 变化时重挂载；`VoiceBubble` 初始化读取 `voicePlayer.isCurrent(clipId)`。
- 列表**不虚拟化**：每页 80 条，向上加载"显示更早的消息"，`useReadingPosition` 迁自 `chat-scroll.js` 的 `pagerPlan/unreadInfo/nextRead/readKey/posKey`；离底 80px 外不自动贴底，出现"新回复"胶囊（`#vc-new-reply`）。
- 保留宿主 DOM 契约（Global Constraints）；`#chat` 内每条消息 `<div class="mes" mesid is_user>` 内含 `.mes_text` 叶子由 `bridge.mountLeaf` 填充。

- [ ] **Step 1: 写失败测试**
  - `tests/desktop-session-fixes.test.mjs`（Node + happy-dom，沿用 `desktop-session.test.mjs` 夹具）：`opens empty MVU conversation with first message within 3s`（B1：卡片带 MVU 脚本、chat 只有元数据头 → `open` 在 3000ms 内 resolve 且 messages.length === 1）；`late save does not clear newer dirty flag`（B3）；`stop during auto-continue check aborts continuation`（B4）；`open resolves only after activation`（B5）；`stale frame TavernHelper call throws VC_STALE_CARD_RUNTIME`（B6）；`setLorebookSettings exists on desktop helper`（B2）。
  - `desktop-ui/tests/chat/MessageLeaf.test.tsx`：`deleting an earlier message keeps later leaf element identity`（B12，断言同一 DOM 节点对象）；`theme toggle and sidebar collapse do not remount leaf`。
  - `Composer.test.tsx`：`Enter sends, Shift+Enter newline, IME composition does not send`；`draft persists per conversation key`。
  - `ChatRoute.test.tsx`：`switching conversation during streaming keeps old stream out of new view`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现** —— 先改 `session.js`/`cards` 让 Node 测试通过，再写 React 组件；表情面板用 emoji-mart（按 token 上皮肤），语音波形用 wavesurfer.js（`peaks` 来自 `voiceWaveHeights`，减弱动效时静止），图片灯箱用 yet-another-react-lightbox。
- [ ] **Step 4: 验证** —— 类型、组件测试、离线单测 `# fail 0`；受管 `--filter nf-chat,nf-operations,nf-cards,nf-media,nf-prompts,f2-browser`（选择器按新 DOM 契约调整，只改选择器不改断言）全部通过。
- [ ] **Step 5: 删除旧电脑端聊天模块与其测试** —— 删除 `desktop/standalone/app.js`、`desktop/standalone/chat-actions.js`（逻辑已迁入）、`desktop/standalone/media.js`、`desktop/standalone/presentation.js`、`desktop/character-panel.js`、`desktop/quick-switch.js`、`desktop/status-card.js` 的 DOM 部分、`desktop/chat*.css`、`desktop/rich.css`；同步删除只测这些模块的单测（如 `tests/desktop-*.test.mjs` 中针对它们的文件），提交信息注明授权。
- [ ] **Step 6: 提交** —— `git commit -m "feat(DR2-5): 聊天页重建与会话缺陷修复（B1–B6、B12、B13）"`

### Task 6: 角色页

**Files:** Create `desktop-ui/src/features/characters/{CharactersRoute.tsx,CharacterGrid.tsx,CharacterDetail.tsx,ImportCharacter.tsx,CreateWizard.tsx,InstanceDialog.tsx,PersonaEditor.tsx,characters.css}`、`src/data/queries/characters.ts`、`extension/vc-model-settings/instance-logic.js`、`desktop-ui/tests/characters/*.test.tsx`；Modify `instance-page.js`、`persona.js`（re-export）；Delete `desktop-ui/src/features/characters/Characters.tsx` 中电脑端专用部分（`bridge/` 仍用的保留）。

**Interfaces:** Consumes T2–T4、T5 `SessionBridge.open`。Produces `useCharacters()`、`useImportCharacter()`、`useCreateInstance()`、`useRenameInstance()`（mutation 成功后 `invalidateQueries(queryKeys.relationships)` 与 `queryKeys.recentChats`）。

- 7 步新建向导、PNG/JSON 导入校验（`inspectCharacterFile/pngHasChara`）、实例名 1–32 字符去控制字符、进入聊天走路由 `/chat/$conversationKey`。
- **B9**：`PersonaEditor` 用 react-hook-form，`formState.isDirty` 交给 `useLeaveGuard`；**B15**：删除角色卡后 `invalidateQueries` 并中止当前会话读取（`bridge.open` 返回 `superseded`）。
- 网格：卡片 `minmax(220px, 1fr)`、圆角 `20`、头像 `72`；详情面板 `400`（DESIGN.md §9/§16.3）；容器查询决定详情并排或覆盖。

- [ ] **Step 1: 写失败测试** —— `PersonaEditor.test.tsx`：`dirty edit blocks back navigation until confirmed`（B9）；`ImportCharacter.test.tsx`：`rejects png without chara chunk with copy "这张图片里没有角色卡"`（文案以 companion-copy 为准，执行时核对）；`CreateWizard.test.tsx`：`seven steps then creates instance and navigates to chat`；`CharactersRoute.test.tsx`：`deleting character refreshes list and clears open conversation`（B15）。
- [ ] **Step 2–4**：确认失败 → 实现 → 类型 + 组件测试 + 离线单测。
- [ ] **Step 5: 删除** 角色相关旧电脑端代码与只测它们的测试（`/native/` 用的保留）。
- [ ] **Step 6: 提交** —— `git commit -m "feat(DR2-6): 角色页重建（含 B9、B15）"`

### Task 7: 记忆与陪伴页

**Files:** Create `desktop-ui/src/features/memory/{MemoryRoute.tsx,MemoryFilters.tsx,MemoryTimeline.tsx,MemoryDetail.tsx,CorrectMemory.tsx,Diary.tsx,Favorites.tsx,memory.css}`、`src/features/inbox/{InboxRoute.tsx,PolicyForm.tsx,FollowUps.tsx,InboxList.tsx,ChannelSheet.tsx,Deliveries.tsx,ReauthDialog.tsx,inbox.css}`、`src/data/queries/{memory.ts,inbox.ts}`、`extension/vc-model-settings/{memory-logic.js,inbox-logic.js}`、`desktop-ui/tests/{memory,inbox}/*.test.tsx`；Modify 对应原文件 re-export。

**Interfaces:** Produces `useMemoryItems(relId, filters)`（分页，`useInfiniteQuery`）、`useCorrectMemory()`、`useForgetMemory()`（`REAUTH_REQUIRED` → 打开 `ReauthDialog`，成功后重试一次）、`useDiaries(relId, month)`、`useProactivePolicy(relId)` + `useSavePolicy()`（409 → 表单显示"我的草稿 / 最新版本"）、`useInbox(filter)`、`useChannels()`、`useDeliveries()`。

- 布局：左筛选 `240`、右栏 `320`、列表最大 `720`（DESIGN.md §16.3）；记忆分段：时间线 / 已钉住 / 待核验 / 已失效 / 日记 / 收藏；"跳到原消息"走 `bridge.open` resolve 后定位（依赖 B5）。
- 文本输入保持光标与 IME（react-hook-form 非受控输入）。

- [ ] **Step 1: 写失败测试** —— `MemoryRoute.test.tsx`：`filters combine type+source+date and survive navigation`；`CorrectMemory.test.tsx`：`saving correction replaces item and keeps draft on 409`；`ReauthDialog.test.tsx`：`password cleared on close; failure keeps draft`；`PolicyForm.test.tsx`：`409 shows mine/latest and load latest replaces form`。
- [ ] **Step 2–4**、**Step 5 删除旧代码与对应测试**、**Step 6 提交** —— `git commit -m "feat(DR2-7): 记忆与陪伴页重建"`

### Task 8: 剧情页

**Files:** Create `desktop-ui/src/features/story/{StoryRoute.tsx,StoryList.tsx,StartWizard.tsx,Stage.tsx,ClueWall.tsx,NpcCast.tsx,ActionBar.tsx,RewindDialog.tsx,EpilogueMemories.tsx,story.css}`、`src/data/queries/story.ts`、`extension/vc-model-settings/story-logic.js`、`desktop-ui/tests/story/*.test.tsx`；Modify `story-page.js` re-export。

**Interfaces:** Consumes `story-action.js`（`commitStoryAction, rewindStory, confirmStoryProjection, decideStoryEpilogue, mapStoryParticipant`）、`story-projection.js`、`SessionBridge`（投影写入当前剧情会话）。Produces `useStoryRuns()`、`useStoryRun(runId)`、`useStoryView(runId, actorId)`。

- 案件卡圆角 `24`、NPC 头像 `64`、证物 `150×86`（DESIGN.md §9）；黑幕合拢与片名开场、NPC 打光、证物翻面（`prefers-reduced-motion` 时直接显示终态）；证物 `flipped` 由服务端数据驱动（修 Story 证物状态不同步）。

- [ ] **Step 1: 写失败测试** —— `StartWizard.test.tsx`：`five steps create run with selected companion`；`Stage.test.tsx`：`committing action disables bar until response and ignores late response after rewind`；`RewindDialog.test.tsx`：`confirm creates branch and navigates`。
- [ ] **Step 2–4**、**Step 5 删除**、**Step 6 提交** —— `git commit -m "feat(DR2-8): 剧情页重建"`

### Task 9: 产品设置（账户 / 模型 / 语音 / 通知 / 外观 / 数据 / 陪伴风格 / 表情包）

**Files:** Create `desktop-ui/src/features/settings/{SettingsRoute.tsx,SettingsNav.tsx,AccountSection.tsx,AccountDialog.tsx,ModelSection.tsx,ProviderForm.tsx,ModelForm.tsx,PurposeBindings.tsx,UsagePanel.tsx,LocalModels.tsx,VoiceSection.tsx,NotificationSection.tsx,AppearanceSection.tsx,DataSection.tsx,CompanionStyle.tsx,StickerSettings.tsx,ConsentGate.tsx,settings.css}`、`src/data/queries/{models.ts,voice.ts,account.ts}`、`extension/vc-model-settings/consent-logic.js`、`desktop-ui/tests/settings/*.test.tsx`；Modify `consent.js`、`data-rights.js` re-export。

**Interfaces:** Consumes `model-logic.js`（不复制校验）、`api.js` 的 provider/purpose/local-models/usage/voice/account 接口。Produces 各 section 组件 + `useSettingsForm(schema, query, mutation)`（react-hook-form + zod；`isDirty` 接 `useLeaveGuard`；409 冲突显示"我的草稿 / 最新版本"；保存不试连，DESIGN 与既有语义）。

- 分类列 `240`、内容最大 `760`、表单行标签列 `200`、控件高 `36`、按钮高 `40`（DESIGN.md §16.3/§16.4）。
- **B7**：`StickerSettings` 提供开关、频率（少 / 标准 / 多）、上传（2–4 字中文标签）、删除，调用 `stickers-logic.js`。**B11**：`AppearanceSection` 每次进入从 store 与当前路由角色读取，不缓存首次值。
- 敏感操作（改密、TOTP、注销、清理语音、导出）沿用 `executeSensitiveAction` 与重验流程；密码输入非受控、关闭即清除。

- [ ] **Step 1: 写失败测试** —— `ModelSection.test.tsx`：`unsaved provider edit blocks category switch`、`409 keeps draft`、`key tri-state: unset/configured/clear`；`AppearanceSection.test.tsx`：`character theme targets current conversation character after switching`（B11）；`StickerSettings.test.tsx`：`upload requires 2-4 Chinese chars`（B7）；`ConsentGate.test.tsx`：`blocks app until three required consents granted`。
- [ ] **Step 2–4**、**Step 5 删除**（`page.js`/`desktop/settings-*.js`/`desktop/appearance.js` 的电脑端部分与只测它们的测试；`/native/` 用的保留）、**Step 6 提交** —— `git commit -m "feat(DR2-9): 产品设置重建（含 B7、B11）"`

### Task 10: 酒馆九类设置

**Files:** Create `desktop-ui/src/features/tavern/{TavernRoute.tsx,ReplyConfig.tsx,PromptOrder.tsx,Formatting.tsx,WorldInfo.tsx,WorldEntryForm.tsx,Extensions.tsx,RegexScripts.tsx,HelperScripts.tsx,Personas.tsx,Backgrounds.tsx,InterfacePrefs.tsx,ApiConnection.tsx,CharacterCard.tsx,CodeField.tsx,tavern.css}`、`src/data/queries/tavern.ts`、`extension/vc-model-settings/desktop/tavern-controller.js`、`desktop-ui/tests/tavern/*.test.tsx`；Modify `desktop/tavern-settings.js`（改为薄包装，供仍需要的原生场景；若无消费者则删除）；`package.json`（`@dnd-kit/core`、`@dnd-kit/sortable`、`@monaco-editor/react`）。

**Interfaces:** Consumes `settings-documents.js`（`vc_changes` 条件提交，冲突整批 409）、`tavern-defaults.js`、`tavern-fields.js`。Produces 九个 section；`CodeField({language:'json'|'markdown'|'css'|'javascript', value, onChange})`（Monaco 资源沿用现有自托管路径）。

- 字段集合、默认值、未知键保留语义与 NF-07 一致（`tavern-controller.js` 由 `tavern-settings.js:24-585` 去 DOM 得到，逻辑不变）。
- **B8**：另存 / 导入预设成功后把新名写入 `oai_settings.preset_settings_openai`（或对应 `power_user[apiId].preset`）并移除孤儿记录；放弃时整批清理。**B14**：删除世界书时同步清理 `world_info.globalSelect`、`world_info.charLore`、当前角色 `data.extensions.world`、当前聊天 `chat_metadata.world_info` 中的同名引用，并随同一次提交保存。
- 提示词顺序用 @dnd-kit 可拖拽 + 键盘排序；`busy` 时所有条目按钮禁用。

- [ ] **Step 1: 写失败测试** —— `ReplyConfig.test.tsx`：`save-as preset updates active preset and leaves no dirty orphan`（B8）；`WorldInfo.test.tsx`：`deleting world clears global/char/chat references in one commit`（B14）；`TavernRoute.test.tsx`：`409 conflict keeps form values and offers reload`、`unknown keys preserved on save`（用 `settings-documents` 夹具断言请求体 `vc_changes` 不含未编辑路径）。
- [ ] **Step 2–4**；受管 `--filter nf-tavern,nf-cards`。
- [ ] **Step 5 删除**、**Step 6 提交** —— `git commit -m "feat(DR2-10): 酒馆设置重建（含 B8、B14）"`

### Task 11: 受管验收场景与回归对齐

**Files:** Create `integrations/sillytavern/scripts/desktop-rebuild-accept.mjs`（场景 `dr2-layout`、`dr2-settings`、`dr2-pages`、`dr2-mvu-new`）；Modify `scripts/managed-scenes.mjs`（注册；移除只针对旧电脑端 DOM 的 `dr-shell`、`dr-overlays`、`dr-pages`、`dr-appearance`、`dr-models`、`dr-settings` 注册及其脚本，依 Owner 授权）、`scripts/desktop-{startup,chat,prompt,card,media,tavern,business,settings}-accept.mjs`（选择器按新 DOM 契约更新，断言不变）。

**Interfaces:** Consumes T1–T10 全部页面。

- `dr2-layout`：对 `390×844`、`744×900`、`1024×768`、`1179×800`、`1180×800`、`1440×900`、`1599×900`、`1600×1000`、`1920×1080`，在每个一级页面断言：`document.scrollingElement.scrollWidth <= innerWidth`；角色面板 / 浮层的 `getBoundingClientRect()` 与对话标题栏、`#send_textarea` 不相交；打开的 Menu/Popover 完全在视口内；`:focus-visible` 元素有可见 outline（计算样式 `outline-style !== 'none'`）；用超长合成数据（角色名 64 字、预览 500 字、世界书条目名 80 字）重复一遍。拖动测试：从 1179 到 1180 再回 1179，`data-chrome` 变化次数恰为 2，聊天草稿与 `#chat.scrollTop` 不变。
- `dr2-mvu-new`：即审计用的 `audit-mvu-empty` 场景定型——新建空 MVU 会话 5 秒内出现开场白且 `#send_but` 可用，控制台无 `ReferenceError`（B1、B2）。
- `dr2-settings`：模型 / 语音 / 外观 / 酒馆主要读写、409、离开保护、敏感操作重验；`dr2-pages`：角色导入与新建、记忆纠正与删除、陪伴策略保存、剧情开局与行动。

- **B10（`/native/` 宽屏误入桌面布局）**：Modify `extension/vc-model-settings/shell.js` 的 `applyChrome`/`chromeForWidth` 调用点——电脑端已不再加载 `shell.js`，`/native/` 只服务手机原生宿主，故在 `/native/` 下恒用 `tabbar` 形态（`<html data-vc-layout="mobile">`，不插入 `.vc-desktop-aurora`）。先在 `tests/shell-native-layout.test.mjs` 写失败测试 `native host stays mobile layout at 1024px`，再修。

- [ ] **Step 1: 写场景与 B10 测试**（场景本身即测试）。
- [ ] **Step 2: 运行** —— `--filter dr2-layout,dr2-mvu-new,dr2-settings,dr2-pages,nf-startup,nf-desktop,nf-chat,nf-operations,nf-prompts,nf-cards,nf-media,nf-tavern,nf-business,nf-settings,f2-browser,f2-native,mb-engine` 全部通过；失败按根因修到通过（修复代码属于对应页面任务的文件，在本任务内修改并在提交信息列出）。
- [ ] **Step 3: 提交** —— `git commit -m "test(DR2-11): 电脑端重建受管场景与回归对齐"`

### Task 12: 视觉自查（Codex 产出截图，Claude 终审）

> 交接后：Codex 完成截图矩阵、`dr2-layout` 通过与自查 `NOTES.md` 后**暂停**，不自行宣布视觉通过；等 Claude 终审再进入 T13。

**Files:** Create `.review-queue/DR2/`（已忽略，不提交）下截图与 `NOTES.md`。

- 截图矩阵：`390×844`、`1024×768`、`1440×900`、`1920×1080` × 浅 / 深 × {聊天（空 / 有会话 / 流式 / 复杂卡）、角色（网格 / 详情 / 新建向导）、记忆（时间线 / 详情 / 日记）、陪伴、剧情（列表 / 舞台）、设置（模型 / 语音 / 外观）、酒馆（回复配置 / 世界书）、弹层（菜单 / 确认 / 冲突）}。用 `desktop-rebuild-accept.mjs --capture`（T11 中加入的截图开关）在受管环境产出。
- Sonnet（visual-inspector 子代理）按 DESIGN.md 与设计第 10.2 节"明显问题定义"逐张初审，列问题；Claude 终审。每个问题回到对应页面任务的文件修复，复跑受影响截图与 `dr2-layout`。
- 交付给 Owner 的精选：每个一级页面浅 / 深各 1 张（1440），附发现与处理说明。

- [ ] **Step 1: 产出截图** → **Step 2: 初审 + 终审** → **Step 3: 修复并复跑** → **Step 4: 写 NOTES.md**（改了什么、发现了什么、如何处理）。

### Task 13: 收尾、全量验证与 backlog 回填

**Files:** Modify `docs/planning/2026-10-31-handoff-backlog.md`（新增 K 节：DR2-1 … DR2-15，与本计划任务一一对应，并在末尾追加：①"合并与部署前置：与 `mb-mobile` 联合发布；`Dockerfile.st` 增加 `mobile-dist` 构建步骤"；②"Helper 11 个手写模块改为构建时编译上游 TS（DR2-14 未做，待评估）"；③"未补齐的 Helper 接口清单（DR2-15 不做部分，无已知卡片消费者）"；④"MB 完成后清理 `/native/` 中 uni-app 不再显示的旧手机外壳（标签栏、会话列表、手机页面栈等），清理前核对 uni-app 的 ST 视图不会露出"）、`TODO.md`「陪伴体验后续」按 ID 回填、`integrations/sillytavern/desktop-ui/README.md`（新架构说明，删去 DR-4 等过时段落）、`integrations/sillytavern/README.md:297` 段落。

- [ ] **Step 1: 确认旧代码已清零** —— `ls integrations/sillytavern/extension/vc-model-settings/desktop/*.js` 只剩 `tavern-defaults.js`、`tavern-fields.js`、`tavern-controller.js`（及 `/native/` 仍 import 的文件，逐个注明消费者）；`grep -rn "!important" integrations/sillytavern/desktop-ui/src --include=*.css` 只剩允许的规则。
- [ ] **Step 2: 全量** —— `bash scripts/check.sh` 通过；T11 的受管场景整组在同一提交上通过。
- [ ] **Step 3: 回收** —— 删除各任务 worktree、`dev-managed/`、`vc-w03-dr2-*` 容器（`docker ps -a --filter label=com.vc.w03=managed`）。
- [ ] **Step 4: 提交** —— `git commit -m "docs(DR2-13): 电脑端重建收尾与清单回填"`

### Task 14: 引擎与复杂卡删减（与 T6–T10 并行）

**Files:** Modify `extension/vc-model-settings/desktop/standalone/engine/**`、`desktop/standalone/cards/**`、`integrations/sillytavern/patches/helper-selfhost-runtime-assets.json`、`desktop-ui/vite.config.mjs`（alias）、`scripts/build-desktop.mjs`。

**Interfaces:** 对外接口不变：`createChatEngine`、`initializeCards`、`readGenerationResponse` 签名与返回值不变。

依据 2026-11-04 摸底（`engine/st/**` 28 个文件：只改 import 路径 14、去 DOM 12、逻辑改动 2；字节级相同 0）：

- **批 A（0 补丁，9 个）**：`cards/` 下 5 个 iframe 内置脚本（`adjust_iframe_height.js`、`adjust_viewport.js` 等，与上游 `JS-Slash-Runner/src/iframe/*.js` 字节一致）改为由 `helper-selfhost-runtime-assets.json` 从上游复制到受管运行副本并按该路径加载；`engine/events.js` → `/lib/eventemitter.js`、`engine/st/constants.js` → `/scripts/constants.js`、`engine/st/events.js` → `/scripts/events.js`、`cards/showdown-underscore.js` → `/scripts/showdown-underscore.js`。
- **批 B（alias 重绑，18 个）**：`engine/st/scripts/macros/**`（`macro-system.js`、7 个 `definitions/*.js`、7 个 `engine/*.js`）与 `cards/{message-formatter,showdown-exclusion,account-storage}.js`：Vite alias 把上游对 `/script.js`、`/scripts/power-user.js`、`/scripts/group-chats.js`、`/scripts/textgen-settings.js`、`/scripts/RossAscends-mods.js`、`/scripts/extensions.js` 的 import 重定向到 `engine/ports.js`，`MacroDiagnostics.js` 保留本地 39 行桩；保留 `#chat .mes[mesid]` 与 `SillyTavern.getContext().variables`。
- **批 C（保留，约 30 个）**：去 DOM / 逻辑改动的文件保留拷贝，文件头注明差异原因。Helper 的 11 个手写模块"改为构建时编译上游 `src/function/*.ts`"**本次不做**（需 alias 掉 Pinia store，风险高于收益），记入 backlog 末尾供以后评估。
- 不修设计第 6 节列出的四个"与上游一致"问题；AGPL 声明与 `ST-LICENSE` 保留。

- [ ] **Step 1: 冻结基线** —— 运行受管 `--filter nf-prompts,nf-regex,nf-chat,nf-cards` 与离线单测，记录通过。
- [ ] **Step 2: 批 A** → 重跑 Step 1 全通过 → **Step 3: 批 B** → 重跑全通过。
- [ ] **Step 4: 提交** —— `git commit -m "refactor(DR2-14): 引擎与复杂卡复用锁定上游模块"`

### Task 15: Tavern Helper 接口补齐（与 T14 串行，同一写入 owner）

原生 ST 下复杂卡可用的 Helper 接口，独立桌面缺 106 个顶层 API、1 个 `_bind`（`_registerMacroLike`）、15 个 `builtin.*`。这是相对原生宿主的回退，按"引擎行为不变"补回；**按卡片实际使用频率分批**，每个函数行为对照上游 `JS-Slash-Runner/src/function/<模块>.ts` 同名实现。

**Files:** Modify `desktop/standalone/cards/{index.js,helper-worldbook.js,helper-message.js,helper-preset.js,helper-script.js,helper-util.js,helper-host.js,ejs-host.js}`、`engine/helper-types.js`；Create `cards/helper-character.js`、`cards/helper-persona.js`、`cards/helper-slash.js`、`cards/helper-inject.js`、`cards/helper-regex.js`；Test `integrations/sillytavern/tests/desktop-helper-api.test.mjs`。

- **批 1 · 漏挂（已实现未导出）**：`getAllEnabledScriptButtons`、`errorCatched`、`isPresetSystemPrompt`、`isPresetNormalPrompt`、`RawCharacter`、`builtin_prompt_default_order`（=`placeholder_prompt_default_order`）、`getFrontendVersion`（=`getTavernHelperVersion` 别名）；同时停止把 `variables`/`globals` 的 10 个 `_` 前缀内部函数泄漏到 `publicApi` 顶层。
- **批 2 · MVU / EJS / 仓库验收必需**：`setLorebookSettings`（读写 `world_info_settings`，B2）、`triggerSlash`、`triggerSlashWithResult`（经 EJS 已有的 `executeSlashCommandsWithOptions` 端口执行）、`_bind._registerMacroLike` 与 `registerMacroLike`/`unregisterMacroLike`。
- **批 3 · 常见复杂卡高频**：世界书旧名包装 7 个（`setLorebookEntries`、`createLorebookEntries`、`createLorebookEntry`、`deleteLorebookEntries`、`deleteLorebookEntry`、`replaceLorebookEntries`、`updateLorebookEntriesWith`，包装现有 `*WorldbookEntries`）、`createLorebook`/`deleteLorebook`；消息增删 `createChatMessages`、`deleteChatMessages`、`rotateChatMessages`（经 `SessionBridge` 的 mutation 路径与 F2 保存）；`injectPrompts`/`uninjectPrompts`（复用 `helper-computation.js` 的注入逻辑）；只读 `getCharData`、`getCharAvatarPath`、`getCurrentCharacterName`、`getCurrentPersonaName`、`getPersonaAvatarPath`、`getChatHistoryBrief`、`getChatHistoryDetail`；`formatAsTavernRegexedString`、`formatAsDisplayedMessage`、`retrieveDisplayedMessage`、`refreshOneMessage`；`getTavernRegexes`、`isCharacterTavernRegexesEnabled`；`builtin.{uuidv4,copyText,renderMarkdown,parseRegexFromString,duringGenerating}`。
- **不做（记入 backlog 末尾，标注"无已知卡片消费者"）**：`audio.*`（13）、`extension.*`（9）、`file.*`（3）、`import_raw.*`（5）、`updateTavernHelper`、`updateFrontendVersion`、角色 / 人设 / 预设的创建与删除类写接口、其余 `builtin.*`（`promptManager`、`reloadEditor*`、`renderPromptManager*` 等依赖原生面板）。调用未实现函数时抛 `Error('VC_HELPER_UNSUPPORTED:<name>')`，并在控制台给出函数名，不静默。

- [ ] **Step 1: 写失败测试** —— `desktop-helper-api.test.mjs`：`exports all batch 1–3 names on TavernHelper and iframe window`（逐名断言 `typeof === 'function'` 或对象）；`setLorebookSettings round-trips world_info_settings`；`triggerSlash '/setvar key=a 1' updates chat variable`；`createChatMessages appends and persists via F2 save once`；`unsupported helper throws VC_HELPER_UNSUPPORTED with name`；`internal _ helpers are not on public TavernHelper`。
- [ ] **Step 2: 运行确认失败** → **Step 3: 按批实现**（每批后跑本测试与 `nf-cards`）→ **Step 4: 验证** 离线单测 `# fail 0`、受管 `--filter nf-cards,dr2-mvu-new`。
- [ ] **Step 5: 提交** —— `git commit -m "feat(DR2-15): 补齐复杂卡常用 Tavern Helper 接口"`
