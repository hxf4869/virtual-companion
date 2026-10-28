# virtual-companion server plugin（V2-W03-S4）

ST 1.19.0（commit `7e8663cd`）服务端插件：Go 模型目录受控取用、三协议真实适配、
Go 管理 API 桥。许可：**AGPL-3.0-only**（ADR-0009 §3）。

## 部署（S1 接线契约，本目录不自动安装）

- 复制本目录到 `<ST 安装目录>/plugins/virtual-companion/`；
  ST `plugin-loader` 从安装目录的 `plugins/` 装载（`src/server-main.js:312`）。
- 开启 `enableServerPlugins: true`；保持 `enableServerPluginsAutoUpdate: false`。
- 配套核心补丁（应用于受管运行副本 `dev-managed/st-run/`，接线见仓库 `scripts/assemble-managed.mjs`；
  `upstream/` 原始树不改）：
  - `../../patches/st-chat-completions-vc-bridge.json`
    （`src/endpoints/backends/chat-completions.js`：钩子①分发前拦截、钩子②CUSTOM
    受控凭据、钩子③④Chat/Claude 最终发送前防线、钩子⑤`/status` 受管连接检查、两处 provider 正文日志收口）
  - `../../patches/st-util-stream-error-log.json`
    （`src/util.js`：流式失败分支的 provider 正文日志收口）
- **受管宿主策略**：插件一经装载即受管——`/generate` 请求缺失/失效绑定标记一律
  显式拒绝（`VC_UNMANAGED_GENERATION`），不回退 ST SecretManager 的旧全局 Key。
  插件未装载时补丁钩子为空操作，S1 的独立原生验收不受影响。
- 插件启动时动态 `import` ST 自带 `src/endpoints/tokenizers.js` 复用其 tokenizer
  计数；部署时必须保留 `<ST>/src/` 与 `node_modules`。取不到时退回 guesstimate
  并在日志/错误元数据标注 `estimator=st-guesstimate`。

## 运行配置（宿主进程环境变量注入，不落盘）

| 变量 | 说明 |
| --- | --- |
| `VC_ST_GO_BASE_URL` | Go `companiond` 基地址（如 `http://127.0.0.1:8080`），管理桥与受控取用共用；缺失只降级对应能力 |
| `VC_ST_PLUGIN_SERVICE_TOKEN` | 受控取用服务令牌（≥32 字节；Go 与插件服务端各持一份，不进浏览器、不打日志） |
| `VC_ST_GO_TIMEOUT_MS` | 上游/Go 请求超时（默认 30000） |

Go 侧需把确切 ST 来源（如 `http://127.0.0.1:8742`）加入 Origin 白名单（写入类请求校验）。

## 管理桥（S3 前端已按此对接）

- 前缀：`/api/plugins/virtual-companion/go/` + Go 完整路径，例：
  `GET /api/plugins/virtual-companion/go/api/v1/admin/providers`。
- 白名单（方法+路径）见 `lib/admin-bridge.js` `ADMIN_BRIDGE_ROUTES`：
  `GET/PUT providers`、`POST providers/{id}/models/discover`、
  `GET model-purposes`、`PUT model-purposes/{purpose}`、
  `GET auth/session`、`POST auth/login`、`POST auth/reauth`。
  其余一律 404；目标地址只来自 `VC_ST_GO_BASE_URL`；权限全部由 Go 决定。
- 调用者凭据：页面发 `X-CSRF-Token`（ST 令牌，过 ST 中间件）+ `X-VC-CSRF-Token`（JS 可读
  `vc_csrf` cookie 值）+ 可选 `X-VC-Expected-Account-ID` / `X-VC-Expected-Session-ID`；
  插件只转发 `vc_session`/`vc_csrf` 两个 cookie，把 `X-VC-CSRF-Token` 映射为 Go 的
  `X-CSRF-Token`，剥离 ST 的 CSRF 头，原样转发 `Origin`。**永不附加服务令牌**——
  管理操作必须由调用者本人的 Go 会话授权，服务令牌不得提升浏览器权限。
- 响应体原样透传（Go `writeJSON` / 错误信封 `{code,message}`）；请求与响应体不写日志。

## 生成链（受控取用 + 三协议）

绑定标记（S3 投影写进 ST 连接设置；桥接每请求解析并核验）：

```
vc-go://model-purposes/FOREGROUND_CHAT?provider=<providerId>&profile=<profileKey>&pr=<providerRevision>&br=<bindingRevision>&scope=<当前会话标识>
```

- `custom` 源放 `custom_url`；`claude` 源放 `reverse_proxy`。除 Anthropic 用 `claude` 源外，
  三协议前端源均为 `custom`——实际出站协议由 Go `provider.protocol` 决定。
- `pr`/`br` 必须是十进制整数（S2 契约 revision 为整数）；非整数按无效标记拒绝。
- **`scope` 是 projection 需要携带的最小当前会话字段**：稳定的当前 chat 标识
  （建议 ST 聊天文件名或 `characterAvatar+chatId`），在切换聊天/角色时变化。
  它只影响工具回合续接的隔离（见下），不影响生成本身。
- 每请求流程：`GET auth/session`（仅 `vc_session`）核验真实 Owner →
  `POST /api/v1/service/model-purposes/{purpose}/resolve`（Bearer 服务令牌，无 Origin，
  revision 以整数传给 Go 比对）→ revision 复核 → 协议分发。浏览器自报的
  `ownerAccountId` 一律不被信任。`ownerAccountId` 以 Go 会话返回的**十进制字符串原样**
  直传（Go 侧严格 `ParseInt64` 并校验正数；字符串传输是为了让超过 JS 安全整数的 bigint ID
  不丢精度，插件不得 `Number()` 转换）。

## 连接检查（原生 `/status` 受管接管，补丁钩子⑤）

- `vc-go://` 标记不是可请求的 HTTP 地址：原生 `/status` 会对它 fetch 失败并留下错误日志、
  模型下拉为空。插件接管后（`lib/status-bridge.js`）：同一套会话核验 + 受控取用 →
  用 resolve 的规范化基地址与凭据做一次**真实** `GET {base}/models` → 只有上游真实成功才
  原样透传 `{data:[...]}`（ST 前端据此显示 Valid 并填充真实上游模型下拉）；失败回 502 固定
  文案，不回显上游正文。绝不篡改 `online_status` 假装联网成功。
- 语义边界：Valid 只表示「上游模型列表已验证（鉴权与地址可达）」，**不代表生成可用**；
  真实生成以前台聊天验收。连接检查只在 Owner 显式点击「连接」时发生，保存配置不会触发。
- 无标记的 `/status`（非受管源的自配地址）交回原生流程；`claude` 源前端本身不请求 `/status`。
- `OPENAI_RESPONSES`：插件内完整适配（请求映射、参数显式映射/拒绝、上下文预算、
  SSE 重组为 ST 可解析的 chat chunk、非流式转 chat completion、usage/取消/错误映射），
  钩子①返回 true，不进原生分支。
- `OPENAI_CHAT_COMPLETIONS` / `ANTHROPIC_MESSAGES`：约束
  `model` / `custom_url` / `reverse_proxy`+`proxy_password`（服务端覆写，不回浏览器）、
  写回输出上限后交回原生链，复用其转换、取消与工具语义
  （返回 false）。原生构造后的最终 requestBody 再经补丁钩子③④
  （`finalOutboundGuard`）复核：出站 URL 与登记一致、`max_tokens` 类字段
  （含 Claude thinking 追加）不超登记上限、上下文预算满足——违反即拒绝发送。
- **原生偏离防线（三协议共用，`VC_NATIVE_DRIFT` 409）**：UI 显示的值必须就是实际发出的值。
  `body.model` 非空且 ≠ 绑定解析到的上游 `modelId` → 拒绝（不静默换模型）；Go 钉住的
  `generationParams.temperature` / `topP`（Chat/Responses 另含 `reasoningEffort`）在请求里
  存在且不同（浮点容差 1e-6）→ 拒绝；请求缺省时才补齐钉住值（投影已把同值写进原生
  设置）；未钉住的参数保持用户值。请求输出上限 > 登记 `maxOutputTokens` 为
  `VC_OUTPUT_LIMIT_EXCEEDED`，不静默夹紧。
- 明确拒绝（400/409/503，错误码 `VC_*`）：无标记（`VC_UNMANAGED_GENERATION`）、
  标记/用途非法、revision 冲突（提示重新加载设置）、原生偏离、Responses 不支持的参数
  （`stop`/`seed`/`logit_bias`/非零 `presence_penalty`/`frequency_penalty`/`top_k`/`n>1`）、
  输出超上限、上下文窗口未知或预算超限、文本补全模式。
- 上下文预算：对**实际转换后的最终出站 body**（messages/input/system/tools/schema）
  以 ST tokenizer 计数（不可用时 guesstimate 并标注）+ 固定协议开销 96 token
  + 输出预留，不得超过登记 `contextWindowTokens`；窗口未知禁用受控生成。
  前端原生裁剪仍由投影写入的窗口/输出值驱动，本预算是最终出站防线而非唯一手段。
- 日志只含元数据（协议、modelId、状态、耗时、estimator），不含对话正文、凭据或
  上游响应体；上游错误对外只给固定文案 + HTTP 状态，不回显上游 error.message。
  未归类的内部异常也只记录 `error.name`（类型级），不打印任意 `error.message`
  （可能来自 provider 解析或敏感请求头）。选定发送路径的 provider 正文日志收口见上述两个补丁。

## 工具回合续接（Responses reasoning items）

- 上游错误体不解析、不回显；工具回合需要把 reasoning item（`encrypted_content`，
  经 `include` 请求，`store:false`）与 `function_call`/`function_call_output` 回传。
- 续接状态进程内短生命周期，**只在同一受控工具回合内生效**，键与校验：
  1. 回合指纹：当前请求尾部 assistant `tool_calls`（id、name、arguments 逐项全等）
     必须与提交续接时该回合的 function_call 清单完全一致；
  2. 用户（ST handle + Go 账号）、配置指纹（provider/binding revision、profile、
     modelId）、`scope`（projection 携带的当前会话标识）三者匹配；
  3. 一次性消费；TTL 10 分钟；取消/失败不提交；新用户回合（尾部不再是工具回合）
     不查表。
- 切换 chat/角色 → `scope` 或回合指纹变化 → 不注入，旧状态丢弃后重新构造。
  不使用 `conversation`/`previous_response_id`，不跨新用户回合继承远端历史，
  不建跨回合远端会话平台。W05/W13 的完整 source/branch/ActorView 约束留后续。

## URL 规范化（三协议一致）

`endpointUrl`（缺省回退 `baseUrl`）为协议基地址，可含自定义前缀与 `/v1`；绝不自动补
`/v1`、绝不换供应商域名、绝不重复方法路径。已带方法路径（`/chat/completions`、
`/responses`、`/messages`）时：Responses 出站原样使用；原生链剥去后交 ST 自行拼接。

## 对 S2/S3 的最小接口反馈（2026-10-28 收口后状态）

- `POST /api/v1/admin/providers/{providerId}/models/discover` 已按现有 Go 路由接入。
- resolve 请求的 `providerRevision`/`bindingRevision` 以 JSON 整数发送；
  `ownerAccountId` 为 Go session 返回的十进制字符串（`accountId` 字段）原样直传——
  Go `ModelPurposeResolveRequest.ownerAccountId` 已改为 `string`（`^[0-9]+$`），
  服务端严格 `ParseInt64`、拒绝非正数；超过 2^53 的合法 int64 账号 ID 不丢精度
  （Go 真库用例覆盖 9007199254740993 往返与邻值拒绝）。
- 尚未接入 `GET /api/v1/admin/model-purposes/{purpose}`（Go 未注册该路由）；
  S3 页面如需单用途详情，先走列表过滤，待 Go 提供后再加白名单一行。
- 投影约定（扩展 `projection.js` 与本插件一致）：原生模型字段写上游 `modelId`（不是
  `profileKey`）；custom 源标记在 `custom_url`、claude 源在 `reverse_proxy`；`scope`
  由扩展按 `角色|聊天|本轮 runId` 组成，插件只作 opaque 字符串用于续接隔离。
