# 确定性补丁（patches/）

本目录存放对锁定上游的确定性补丁规格。原则：`upstream/` 原始检出一律不改；补丁只作用于
bootstrap 复制到 dataRoot（`dev/data/default-user/extensions/…`）的副本；每个规格声明输入与输出的
SHA256，bootstrap / start 预检 / status 与 `tests/patcher.test.mjs` 都按该值校验，输出可逐字节复现。

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
