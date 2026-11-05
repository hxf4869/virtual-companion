# DR2 T12：GitHub 复审入口

Owner 将本轮复审交给 ChatGPT Pro 网页版或独立 Astra 会话。源码、报告和原尺寸 PNG 均可从本页在 GitHub 打开。T12 待独立视觉结论，DR2-13 尚未开始。

- **代码**：[候选 `82c64427`](https://github.com/hxf4869/virtual-companion/tree/82c6442746531f82e21e547a8344d1ba9fcdfc42) · [首轮 FAIL 后的修复 diff](https://github.com/hxf4869/virtual-companion/compare/bb0d63475d50e1f3bef4be780dfda05762dbb29a...82c6442746531f82e21e547a8344d1ba9fcdfc42) · [完整重建 diff](https://github.com/hxf4869/virtual-companion/compare/3131d92bf08a2f10c93d4bcf99bd4a16e9cbf5c2...82c6442746531f82e21e547a8344d1ba9fcdfc42)。
- **标准**：[DESIGN.md](../../DESIGN.md) 的明确数值优先，其余及深色模式以[旧实现 `3131d92b`](https://github.com/hxf4869/virtual-companion/tree/3131d92bf08a2f10c93d4bcf99bd4a16e9cbf5c2) 为准；[批准设计](../../docs/superpowers/specs/2026-11-04-desktop-react-rebuild-design.md) §10.2 定义视觉门槛。handoff R2 的 tokens 初稿不作为数值依据。
- **截图**：[Claude 首轮 FAIL 报告](./CLAUDE-AUDIT.md)、[首轮交接和 169 张原图](https://github.com/hxf4869/virtual-companion/tree/bb0d63475d50e1f3bef4be780dfda05762dbb29a/.review-queue/DR2)、[复审矩阵 169 张和 F9 专项图](./review-2/)。首轮图是失败对照，视觉基准仍是 DESIGN.md 和旧实现。

| 优先复审 | 首轮问题图 | 本轮图 |
| --- | --- | --- |
| F1/F2/F5/F16/F17：按钮、发送和停止图标、分段气泡及应隐藏的文本 | [390px 流式](./03-chat-streaming-390x844-dark.png)、[剧情舞台](./13-story-stage-1440x900-light.png) | [390px 流式](./review-2/03-chat-streaming-390x844-dark.png)、[1920px 流式](./review-2/03-chat-streaming-1920x1080-dark.png)、[剧情舞台](./review-2/13-story-stage-1440x900-light.png) |
| F3/F4/F6/F7：空会话壳层、流式状态条和贴底日期 | [空会话](./01-chat-empty-1440x900-light.png)、[流式](./03-chat-streaming-390x844-light.png) | [空会话](./review-2/01-chat-empty-1440x900-light.png)、[流式](./review-2/03-chat-streaming-390x844-light.png)、[聊天](./review-2/02-chat-active-1440x900-dark.png) |
| F9/F10：复杂卡提示留在对话区内，卡片操作与输入区有间距 | [390px 复杂卡](./04-chat-card-390x844-light.png) | [390px 长提示实测](./review-2/F9-toast-390x844-light.png)、[390px 复杂卡](./review-2/04-chat-card-390x844-light.png)、[1440px 深色](./review-2/04-chat-card-1440x900-dark.png) |
| F11/F12：玻璃材质、宽档详情右列与窄档覆盖层 | [1440px](./06-characters-detail-1440x900-light.png)、[1920px](./06-characters-detail-1920x1080-dark.png) | [390px](./review-2/06-characters-detail-390x844-light.png)、[1440px](./review-2/06-characters-detail-1440x900-light.png)、[1920px](./review-2/06-characters-detail-1920x1080-dark.png) |
| F14/F15：日记工具行、陪伴静默时段在窄窗可读 | [日记](./10-memory-diary-390x844-light.png)、[陪伴](./11-inbox-390x844-light.png) | [日记](./review-2/10-memory-diary-390x844-light.png)、[陪伴](./review-2/11-inbox-390x844-light.png) |
| F18–F21/F23：语音开关、设置导航与酒馆导入 | [390px 语音](./15-settings-voice-390x844-light.png)、[酒馆](./17-tavern-reply-1440x900-light.png) | [390px 语音](./review-2/15-settings-voice-390x844-light.png)、[外观](./review-2/16-settings-appearance-1440x900-dark.png)、[酒馆](./review-2/17-tavern-reply-1440x900-light.png) |
| F22：向导、菜单、离开确认与冲突弹层的模糊及可读性 | [向导](./07-characters-wizard-1440x900-light.png)、[确认](./20-overlay-confirm-1440x900-light.png) | [向导](./review-2/07-characters-wizard-1440x900-light.png)、[菜单](./review-2/19-overlay-menu-1440x900-dark.png)、[确认](./review-2/20-overlay-confirm-1440x900-light.png)、[冲突](./review-2/21-overlay-conflict-1440x900-light.png) |

如果 GitHub 文件页只返回文件名，打开 Raw 图像；例如 [F12 首轮 PNG](https://raw.githubusercontent.com/hxf4869/virtual-companion/bb0d63475d50e1f3bef4be780dfda05762dbb29a/.review-queue/DR2/06-characters-detail-1440x900-light.png)、[F12 本轮 PNG](https://raw.githubusercontent.com/hxf4869/virtual-companion/37d304f418cb949f1387d9788b1b1e883f43f5ae/.review-queue/DR2/review-2/06-characters-detail-1440x900-light.png)、[F9 本轮 PNG](https://raw.githubusercontent.com/hxf4869/virtual-companion/37d304f418cb949f1387d9788b1b1e883f43f5ae/.review-queue/DR2/review-2/F9-toast-390x844-light.png)。

## 可复制的复审提示词

> 请作为独立审核者，只读复审 Virtual Companion 的 DR2 T12。入口：https://github.com/hxf4869/virtual-companion/blob/desktop-react-rebuild/.review-queue/DR2/NOTES.md 。只审候选 `82c64427`，按该页固定链接读取 DESIGN.md、批准设计 §10.2、旧实现 `3131d92b`、Claude 首轮 FAIL 报告、修复 diff 和新旧截图。
>
> 先对照 F1、F2、F5、F12、F17、F22、F23 和 F9，再检查其余发现及修复引入的新回归。覆盖四档宽度、明暗主题和减弱动效/透明度组合；报告实际看过多少张、哪些状态没看到。逐项给出结论、截图和必要的代码行链接、影响与最小建议。核对修复 diff 是否弱化了原业务断言、越过原生桥边界，或破坏首轮已确认的行为。
>
> 网页模式可做源码与截图复审；只有实际看见图像才计入审图。打不开的图记为未看，未亲自执行的运行检查记为 NOT_RUN。交接页的测试数字是已有工程证据。Astra 如有独立环境，可针对证据缺口复跑相关场景，单列命令及结果。
>
> 输出 T12 视觉结论 PASS / FAIL / BLOCKED 及依据。仍有明确阻塞问题给 FAIL；必要证据缺失、无法判定时给 BLOCKED。若同时做全分支代码审计，请将其发现与 T12 视觉结论分开。不要改代码、提交、发布或进入 T13。

## 已有工程验证

下列为调度者在 `82c64427` 上的实测记录：

- `bash scripts/check.sh` **9/9 PASS**（50s，含 Go、离线集成和双构建）；Vitest **141/141 PASS**（37 文件）。
- 受管整组 **18/18 PASS**，包括 `dr2-layout`、`dr2-pages`、`dr2-settings`、`dr2-mvu-new`、`nf-*`、`f2-browser`、`f2-native` 和 `mb-engine`。`dr2-pages` 用本机 11438 的 `qwen3-embedding:0.6b`；手机引擎使用隔离构建的 `mb-mobile@ff2af0c0` H5 产物。
- 同提交、独立受管栈运行 `catalog-admin` + `dr2-layout --capture`，**2/2 PASS**（布局及采集 352682ms）。保留 108 组原几何检查和业务断言，新增真实控件皮肤、图标形状、屏幕阅读器隐藏、右列详情、语音开关、弹层滤镜与实际 SSE 分段等检查。
- 原生桥的 48 个实际导出完整一致，无新增 CSS 产物。原生酒馆编辑器回到原消费者的样式入口；本轮无 Go/OpenAPI/catalog 变更。

生产构建和提示叠层已在真实浏览器复核：F22 的标准模糊原被后置 WebKit 声明吞掉，调整声明顺序后向导和消息菜单生效；F9 的固定定位曾被压缩器移到规则末尾覆盖宿主定位，分开规则后，390 与 1440 两档的长提示均高 48px、距标题栏 11px、正文最多两行。提示宿主使用 DESIGN 的提示层级 70，高于外壳层 20；在两个宽度的提示中心实际命中提示元素。设置用途绑定回归保留 PUT 成功及原业务断言，额外等待保存状态结算；剧情入局回执延迟 500ms 时，保存等回执后才触发。

截图包含 21 个真实页面或交互状态 × 4 档窗口 × 2 主题，以及 [1440px 减弱动态与透明度组合](./review-2/22-chat-1440x900-dark-reduced-motion-transparency.png) 1 张。窗口为 390×844、1024×768、1440×900、1920×1080，逐一核对文件名与 PNG 实际尺寸。流式、复杂卡 iframe/MVU、未保存离开和 F2 409 均由真实操作触发；只使用合成账号和数据。另有一张 F9 实测图，使用实际 Toastr 端口发出合成长提示，方便核对常规矩阵采图时已淡出的通知。

在新 worktree 中按仓库说明准备锁定上游、依赖、Chromium 和隔离受管端口后，可用 `node integrations/sillytavern/scripts/desktop-rebuild-accept.mjs --capture` 重采。命令会写该 worktree 的 `.review-queue/DR2/`，请在临时 worktree 运行，以保留首轮图与本轮交接资料。
