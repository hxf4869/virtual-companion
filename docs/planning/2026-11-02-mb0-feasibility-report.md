# MB-0 可行性验证报告（ADR-0011 D 路线）

日期：2026-11-02。分支 `mb-mobile`。结论先行：**D 路线可行，继续 MB-2**；有 4 项需写进后续设计（第 3 节）。
App 壳相关验证按 Owner 2026-11-02 决定随 MB-6 搁置，本报告只记录已跑通的部分（第 4 节）。

## 1. 方法

- 受管场景 `mb0-spike`（`integrations/sillytavern/scripts/mb0-spike-accept.mjs`，需显式 `--filter`）：
  合成 Owner、假模型、独立端口。同源验证页 `fixtures/mb0/index.html` 运行时复制到受管 `st-run/public/mb0/`，结束删除，不进生产。
- 验证页做法与 ADR-0011 §1 一致：先用服务端接口直接显示历史，同时在同源隐藏 iframe 里启动完整 ST（含 Tavern Helper / EJS / MVU 与自有扩展），
  外层只通过一个适配对象驱动引擎。
- 手机条件：Chromium 390×844、3 倍像素、触屏，CPU 降速 4 倍（近似中端手机）。真机性能见第 5 节。
- 复现（`.vc-wt.env` 为本机独立端口配置，不入库）：`set -a; . ./.vc-wt.env; set +a; node integrations/sillytavern/scripts/accept-managed.mjs --filter mb0-spike`，
  结果写 `integrations/sillytavern/dev-managed/artifacts/mb0/report.json`。

## 2. 结果

### 2.1 启动（CPU 降速 4 倍，40 条历史）

| 阶段 | 冷启动 | 热启动（HTTP 缓存在） |
|---|---|---|
| 历史可见（服务端接口直读） | 约 0.1 s | 约 0.15 s |
| ST 上下文可用 | 约 0.7 s | 约 0.7 s |
| 引擎就绪（设置加载完、可操作） | 约 5.2 s | 约 3.8 s |
| 打开会话（可发送） | 约 7.2 s | 约 5.4 s |

结论：历史先行使首屏不受引擎启动影响；发送需等引擎就绪，期间按 DESIGN.md §17 M14「正在连接…」并保留输入。

### 2.2 内存（Chromium JS 堆，稳定后）

| 页面 | JS 堆 | DOM 节点 |
|---|---|---|
| 只开 ST 网页 | 约 34–39 MB | 约 3.9 万 |
| 验证页 + 隐藏 ST | 约 43–60 MB | 约 4.9–6.8 万 |

隐藏引擎带来的额外开销约 10–20 MB，主要是 ST 自身；正式外层界面会再增加，但量级可接受。

### 2.3 适配接口覆盖（全部 PASS）

| 能力 | 入口 | 结果 |
|---|---|---|
| 发送 + 流式 | 原生输入框 + `#send_but`（与现有扩展同一路径，含连发合并） | 外层收到流式事件；首个片段约 3.5 s，其中大部分是陪伴模式的连发合并等待 |
| 停止 | `getContext().stopGeneration()` | 已生成部分保留 |
| 重新生成 | `getContext().generate('regenerate')` | 替换最后一条回复 |
| 新候选 / 切换候选 | 原生 `.swipe_right` / `.swipe_left` | 生成第 2 个候选并能切回 |
| 编辑 | 改 `chat[i]` + `saveChat()` + `reloadCurrentChat()` | 写入服务端文件 |
| 删除 | `getContext().deleteMessage()`（与现有扩展相同） | 原生自动保存，服务端文件同步 |
| 一份聊天 | 引擎内存与服务端文件逐条比对 | 一致 |

不需要修改 ST 核心。

### 2.4 复杂卡（Tavern Helper / EJS / MVU）

| 项 | 结果 |
|---|---|
| 隐藏状态下收到含 `<UpdateVariable>` 的回复，MVU 更新变量并写入聊天文件 | PASS（trust 42，文件同值） |
| 切到 ST 视图后状态栏 iframe 渲染并执行脚本 | PASS（高约 200 px，读数正确） |
| 卡片脚本在嵌套 iframe 中运行 | 正常；Tavern Helper 的 `window.top` 劫持在浏览器里不可用（其源码已按非致命处理），未见影响 |
| 稳定性 | 最近 5 轮完整运行 4 轮通过；1 轮隐藏状态下 MVU 未处理更新，原因未定位。MVU 初始值（InitVar）出现时间不固定，嵌套与否都见过晚到 |

MB-3 适配层对 MVU 增加就绪等待与失败提示，并在聊天受管场景中重复覆盖；如再现，优先对比同一步骤在顶层 ST 的结果。

## 3. 写进后续设计的发现

1. **`/m/` 入口要在自有服务端插件登记**：`host-auth` 只在 `/`、`/auth/access` 绑定 ST 会话；其他路径首个请求返回 409。
   写请求还需 `x-vc-expected-account-id / session-id`，可从 `GET /auth/api/session` 取得。MB-2 在插件里为 `/m/` 增加静态提供与绑定白名单（不改 ST 核心）。
2. **引擎里的宿主弹窗必须由外层接管**：首次打开带内嵌世界书或脚本的卡，ST 会弹确认框；隐藏时无人可点。
   MB-3 适配层监听 `dialog.popup[open]`，切到 ST 视图让用户确认，不自动同意。
3. **ST 视图要展开聊天区**：引擎内的 vc 外壳默认收起聊天；切到 ST 视图时调用现有 `#vc-shell.openConversation`，状态栏才有尺寸。
4. **重载引擎前先卸载旧页**：直接改 `src` 时旧页仍在，会触发 F2 保存冲突保护；先等保存结束、切空白页、确认卸载后再加载。

卡片的一次性准备（内嵌世界书绑定到角色）沿用 ST 原有操作，在 ST 视图中完成。

## 4. Android（随 MB-6 搁置，已跑通的部分）

- uni-app 命令行（`@dcloudio/uni-app 3.0.0-5030420261029002`，编译器 5.34）构建 App 资源，与 DCloud 离线 SDK 5.34（2026-10-30）一致。
- 离线工程用本机签名与 DCloud AppKey（AppID `__UNI__CD7650F`，包名 `com.virtualcompanion.owner`）打出 APK，MuMu（Android 12）安装运行，AppKey 校验通过，web-view 发起加载。
- 已写好待验证的原生桥（前台服务、带快捷回复的通知、分享入口），未联调。工程与密钥在仓库外 `~/.virtual-companion-local/android/`。
- MuMu 自带 WebView 为 95 版（2021），远旧于真机；MB-6 先升级模拟器 WebView 或以真机为准。

## 5. 未验证（待真机 / 随 MB-6）

厂商后台策略、真实手机性能与内存压力、App 内 Cookie 保持、麦克风权限、软键盘、返回键、后台 30 分钟连接、通知快捷回复、系统分享。

## 6. 检查

- `mb0-spike` 受管场景：最终轮 PASS（接口 7 项、复杂卡 2 项）。
- ST 离线单测：场景清单测试同步登记 `mb0-spike` 后 PASS；`backup-pg.test.mjs` 真库用例在本分支与主工作区同一基准提交上同样失败
  （OrbStack 报「容器正在删除」），与本次改动无关，未处理。
