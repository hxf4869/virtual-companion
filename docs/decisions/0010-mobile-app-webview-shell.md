# ADR-0010：移动 App 采用 uni-app 壳 + web-view 承载同一 ST Web

- 状态：Superseded by [ADR-0011](0011-mobile-uniapp-ui-st-engine.md)（2026-11-02）
- 日期：2026-11-01
- 决策人：Owner
- 关联：ADR-0009（V2 SillyTavern 宿主方向）、`DESIGN.md` 第 15 节、`docs/planning/2026-11-01-ux11-desktop-immersive-plan.md`

## 背景

Owner 决定电脑端与手机端分别设计（UX-11），并计划以后提供 iOS / Android App。旧 Vue / uni-app 前端已在
W15 删除；当前手机界面是 SillyTavern 网页宿主里的手机布局。聊天依赖 SillyTavern、Tavern Helper、EJS / MVU
与角色卡脚本，它们需要浏览器 DOM 与脚本环境，uni-app 的原生页面和非 H5 逻辑层无法直接运行。

## 决策

1. 未来的 iOS / Android App 采用 **uni-app（或同类）壳 + `web-view`**，加载与浏览器相同的 ST Web 源。
   手机界面只有一套：现在的手机网页布局（< 744px）。H5 就是同一网页。
2. 壳只做网页做不到或做不好的系统能力：
   - 安全区与状态栏透传（网页继续使用 `env(safe-area-inset-*)`）；
   - Android 系统返回键映射为网页内返回（与网页内返回按钮同一事件，不另建导航栈）；
   - 麦克风、通知权限申请；文件下载与系统分享；
   - 从后台恢复时通知网页刷新会话状态。
3. 壳内**不放业务逻辑、不保存第二份业务状态、不直连 Go 或 TTS / ASR**；所有请求仍经网页走既有同源路径。
4. 不采用原生重写聊天：那会失去角色卡脚本、Tavern Helper 与 EJS / MVU 生态，并产生两套业务实现。
5. 设计层两端共享颜色、组件状态与业务语义（DESIGN.md）；App 壳不引入另一套视觉规范。

## App 立项前必须验证（本 ADR 不声称已通过）

登录会话与 Cookie 在 web-view 中的保持、系统返回、安全区、软键盘与输入区避让、音频播放与麦克风权限、
文件选择与下载、角色卡 iframe / 脚本、后台恢复与长连接重建、深色模式与 `theme-color`。
任何一项不通过，先回到本 ADR 修订，而不是在壳里补业务逻辑。

## 本 ADR 不授权

- 开始编写 App 代码、创建 uni-app 工程、申请证书或上架；
- 新增生产依赖或桥接层；
- 对 Owner 以外的人提供服务（ADR-0009 §3、§4 继续有效，Tavern Helper 许可禁止商业使用）。

## 后果

- 手机网页布局继续是唯一的手机 UI；UX-11 的桌面改版不得改变手机像素（见实施方案第 1 节）。
- DESIGN.md 第 15 节改为引用本 ADR。
- App 立项时新开路线图条目，先做上面的验证清单，再决定壳的具体技术。
