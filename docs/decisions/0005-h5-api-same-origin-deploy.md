# ADR-0005：冻结 H5/API 同源反代部署

- 状态：Accepted
- 日期：2026-08-23
- 决策范围：Technical Alpha / 受控 Beta 的 H5 与 API 传输边界（S0-06）

## 背景

H5 使用 `credentials: include`、HttpOnly refresh cookie（SameSite=Lax）和 double-submit CSRF。
若 H5 与 API 分属不同站点，浏览器第三方 cookie、CORS 预检和 CSRF Origin 会同时失效或被绕过。
仓库已用 Caddy 把 H5 静态包和 `/api/*` 挂在同一 `VC_DOMAIN` 下，但 CORS 方法缺 PUT、Origin
白名单未拒绝通配符，也未把该模型写成部署契约。

## 决策

1. Technical Alpha / 受控 Beta **只支持同源反代**：Caddy（或等价同源入口）在同一 host-origin
   提供 H5 与 `/api/*`。Vite 开发服务器通过 `/api` 代理保持同源。
2. Origin 白名单只接受精确 `http(s)://host[:port]`。`*`、`null`、通配 host、带 path/query
   的值在启动解析时 fail-closed。Compose 注入 `VC_CORS_ALLOWED_ORIGINS=https://$VC_DOMAIN`。
3. CORS 允许 GET/POST/PUT/PATCH/DELETE/OPTIONS，**不允许** `Access-Control-Allow-Credentials`
   （cookie 走同源，不靠跨域 CORS 携带）。
4. 不得为了“让 CORS 工作”关闭 CSRF、放开任意 origin，或把 access/refresh token 写入
   `localStorage`。
5. 同站不同源或跨站（`SameSite=None; Secure`、host-only/Domain cookie）**不是**当前受支持模型；
   需要独立 Owner 决策和真实浏览器验收，不得在本 ADR 下默认启用。

## 结果

- 同源 smoke（Caddy + runtime）是唯一声称可用的浏览器会话路径。
- 未授权 Origin 的状态变更请求被 CSRF/Origin 门禁拒绝。
- 通配 origin 无法进入运行配置。
