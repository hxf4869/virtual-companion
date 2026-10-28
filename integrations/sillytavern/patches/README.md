# 确定性补丁（patches/）

本目录存放对锁定上游的确定性补丁规格。原则：`upstream/` 原始检出一律不改；补丁只作用于运行副本
（helper 资产补丁 → bootstrap 复制到 dataRoot 的副本，ST 核心桥补丁 → assemble-managed 复制到
`dev-managed/st-run` 的运行副本）；每个规格声明输入与输出的 SHA256，bootstrap / assemble-managed /
start 预检 / status 与 `tests/patcher.test.mjs` 都按该值校验，输出可逐字节复现。

## helper-selfhost-runtime-assets.json

- **对象**：Tavern Helper 4.11.3（commit `0af42106`）编译产物 `dist/index.js`（复制到 dataRoot 的副本）。
- **理由**：Helper 的脚本 / 渲染 iframe 模板、iframe 构建器与面板在运行期从 `testingcf.jsdelivr.net`
  加载无版本 CDN 资源（jQuery / jQuery UI / touch-punch / Font Awesome / Vue / Vue Router / log.js），
  无公开扩展点可覆盖。V2 要求选定运行链不依赖可变 CDN（ADR-0009 §3 固定版本；执行计划 §6.5 R-CDN），
  故做字串替换，指向由 `vendor.lock.json` 固定（npm 官方 tarball sha512 + 逐文件 sha256）并自托管在同源
  路径 `/scripts/extensions/third-party/JS-Slash-Runner/lib/vendor/…` 下的资源。
- **固定上游**：规格内声明 `upstream.commit`；bootstrap 每次先校验 `upstream/` HEAD 与原始产物 SHA
  一致才会重放补丁。升级 Helper 版本必须重算 `expected_input_sha256` / `expected_output_sha256`
  并逐条复核 `replacements[].count` 命中次数。
- **保留不动**：内置脚本市场（tavern_resource，30 处）与优化面板懒加载（1 处）的 jsdelivr 引用按上游
  原样保留——它们只在用户主动安装脚本或打开优化面板时加载，不属于默认运行链；见规格的 `left_as_is`。
- **可去除条件**：上游 Helper 改为相对 / 同源路径加载或提供可配置资源基址；或 V2 替换 Helper 依赖。
  满足后删除本规格与 `vendor.lock.json` 对应条目，并重跑 bootstrap / start 预检 / 相关测试。

## st-chat-completions-vc-bridge.json（受管核心补丁）

- **对象**：SillyTavern 1.19.0（commit `7e8663cd`）`src/endpoints/backends/chat-completions.js`
  （复制到 `dev-managed/st-run` 运行副本的文件；upstream 原始检出不改）。
- **理由与钩子**：见规格 `reason`。ST 的 `/generate` 是前台唯一生成链的最终出站口，server plugin
  只能挂 `/api/plugins/*` 且位于核心路由之后，无法约束原生生成；补丁在 source 分发前插入
  `virtual-companion.bridge` 的 `interceptGenerate`（Responses 协议整体适配并终局）、CUSTOM 取密改读
  `request.vcGoCredential`（凭据不镜像进 ST SecretManager）、转换后的 requestBody 经
  `finalOutboundGuard` 复核，并去掉两处错误日志中的 provider 响应体入参。插件缺失时符号不存在，
  全部钩子为空操作，原生行为不变。
- **应用与校验**：`assemble-managed.mjs` 构建运行副本时应用（输入取 upstream 原文件，
  `expected_input_sha256` / `expected_output_sha256` 硬校验）；`start-managed.mjs` 预检与
  `status-managed.mjs` 复核两个 SHA；派生产物记录在 `dev-managed/derived-manifest.json`。
- **可去除条件**：见规格 `removal_condition`（上游原生提供等价出站钩子，或 V2 放弃 ST 前台受管生成链）。
  升级 ST 版本必须重算两个 SHA 并复核锚点命中次数（`/status` 路由存在同形取密行与同形 fetch 行）。

## st-util-stream-error-log.json（受管核心补丁）

- **对象**：SillyTavern 1.19.0（commit `7e8663cd`）`src/util.js`（同样只作用于 `dev-managed/st-run` 副本）。
- **理由**：`forwardFetchResponse` 流式失败分支把 provider 完整错误正文写入 console.warn（会落入
  st.log）；收口为只记录状态码与状态文本，浏览器收到的错误体保持原生行为。与上一个补丁的两处
  日志收口配套（受管三协议流式路径都经过该函数）。
- **应用与校验**：同上（assemble-managed 应用，start-managed / status-managed 复核）。
