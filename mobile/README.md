# mobile — 手机界面（uni-app）

决策见 `docs/decisions/0011-mobile-uniapp-ui-st-engine.md`，界面规范见 `DESIGN.md` 第 17 节。

- `npm ci`（只装一次）；`npm run build:h5` 构建 H5 并发布到 `integrations/sillytavern/server-plugin/virtual-companion/mobile-dist/`（不入库），
  服务端插件在 `/m/` 同源提供。受管环境装配与生产镜像（`ops/deploy/v2/Dockerfile.st` 的 `mobile` 阶段）都使用该目录。
- `npm test` 或 `bash scripts/check.sh`：离线单测（主题运行时、token 守护），不需要 npm 依赖。
- 引擎默认同源加载明确原生入口 `/native/`；该入口共用 Go 身份准入，原生资源仍从根路径加载。`/m/` 保持手机外壳入口。
- 原生提示词准备在记忆召回前经 F2 提交当前 metadata；完整保存取消已覆盖的 metadata 延迟保存，避免本端定时器推进召回版本。
- 主题：`src/themes/<id>.mjs` 只含数据（各模式语义 token + 组件变体选择），在 `src/themes/index.mjs` 登记；
  页面与组件只用 `var(--vc-*)`。uni 统计已在 `src/manifest.json` 关闭，页面不得发起跨域请求。
- 图标：`src/static/icons/lucide.svg`（lucide-static 0.460.0 子集，ISC，见同目录 LICENSE 与 SOURCE）。
