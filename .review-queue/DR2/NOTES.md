# DR2 T12：修复后待 Claude 复审

本轮代码候选为 `82c64427`。首轮终审在 `bb0d6347` 判定 FAIL，保留[首轮审计报告](./CLAUDE-AUDIT.md)及同目录的 169 张原图；首轮交接可用 `git show bb0d6347:.review-queue/DR2/NOTES.md` 查看。请以 [review-2/](./review-2/) 中的 169 张新图复审，视觉结论待 Claude，DR2-13 尚未开始。

对照依据：有明确数值的以 DESIGN.md 为准，其余及深色模式以 `codex/desktop-independent-frontend@3131d92b` 为准。handoff R2 的 tokens 初稿不作为数值依据。

| 优先复审 | 新图 |
| --- | --- |
| F1/F2/F5/F16/F17：按钮、发送和停止图标、分段气泡及应隐藏的文本 | [390px 流式](./review-2/03-chat-streaming-390x844-dark.png)、[1920px 流式](./review-2/03-chat-streaming-1920x1080-dark.png)、[剧情舞台](./review-2/13-story-stage-1440x900-light.png) |
| F3/F4/F6/F7：空会话壳层、流式状态条和贴底日期 | [空会话](./review-2/01-chat-empty-1440x900-light.png)、[流式](./review-2/03-chat-streaming-390x844-light.png)、[聊天](./review-2/02-chat-active-1440x900-dark.png) |
| F9/F10：复杂卡提示留在对话区内，卡片操作与输入区有间距 | [390px 长提示实测](./review-2/F9-toast-390x844-light.png)、[390px 复杂卡](./review-2/04-chat-card-390x844-light.png)、[1440px 深色](./review-2/04-chat-card-1440x900-dark.png) |
| F11/F12：玻璃材质、宽档详情右列与窄档覆盖层 | [390px](./review-2/06-characters-detail-390x844-light.png)、[1440px](./review-2/06-characters-detail-1440x900-light.png)、[1920px](./review-2/06-characters-detail-1920x1080-dark.png) |
| F14/F15：日记工具行、陪伴静默时段在窄窗可读 | [日记](./review-2/10-memory-diary-390x844-light.png)、[陪伴](./review-2/11-inbox-390x844-light.png) |
| F18–F21/F23：语音开关、设置导航与酒馆导入 | [390px 语音](./review-2/15-settings-voice-390x844-light.png)、[外观](./review-2/16-settings-appearance-1440x900-dark.png)、[酒馆](./review-2/17-tavern-reply-1440x900-light.png) |
| F22：向导、菜单、离开确认与冲突弹层的模糊及可读性 | [向导](./review-2/07-characters-wizard-1440x900-light.png)、[菜单](./review-2/19-overlay-menu-1440x900-dark.png)、[确认](./review-2/20-overlay-confirm-1440x900-light.png)、[冲突](./review-2/21-overlay-conflict-1440x900-light.png) |

工程验证均在 `82c64427` 上完成：

- `bash scripts/check.sh` **9/9 PASS**（50s，含 Go、离线集成和双构建）；Vitest **141/141 PASS**（37 文件）。
- 受管整组 **18/18 PASS**，包括 `dr2-layout`、`dr2-pages`、`dr2-settings`、`dr2-mvu-new`、`nf-*`、`f2-browser`、`f2-native` 和 `mb-engine`。`dr2-pages` 用本机 11438 的 `qwen3-embedding:0.6b`；手机引擎使用隔离构建的 `mb-mobile@ff2af0c0` H5 产物。
- 同提交、独立受管栈运行 `catalog-admin` + `dr2-layout --capture`，**2/2 PASS**（布局及采集 352682ms）。保留 108 组原几何检查和业务断言，新增真实控件皮肤、图标形状、屏幕阅读器隐藏、右列详情、语音开关、弹层滤镜与实际 SSE 分段等检查。
- 原生桥的 48 个实际导出完整一致，无新增 CSS 产物。原生酒馆编辑器回到原消费者的样式入口；本轮无 Go/OpenAPI/catalog 变更。

生产构建和提示叠层已在真实浏览器复核：F22 的标准模糊原被后置 WebKit 声明吞掉，调整声明顺序后向导和消息菜单生效；F9 的固定定位曾被压缩器移到规则末尾覆盖宿主定位，分开规则后，390 与 1440 两档的长提示均高 48px、距标题栏 11px、正文最多两行。提示宿主使用 DESIGN 的提示层级 70，高于外壳层 20；在两个宽度的提示中心实际命中提示元素。设置用途绑定回归保留 PUT 成功及原业务断言，额外等待保存状态结算；剧情入局回执延迟 500ms 时，保存等回执后才触发。

截图包含 21 个真实页面或交互状态 × 4 档窗口 × 2 主题，以及 [1440px 减弱动态与透明度组合](./review-2/22-chat-1440x900-dark-reduced-motion-transparency.png) 1 张。窗口为 390×844、1024×768、1440×900、1920×1080，逐一核对文件名与 PNG 实际尺寸。流式、复杂卡 iframe/MVU、未保存离开和 F2 409 均由真实操作触发；只使用合成账号和数据。另有一张 F9 实测图，使用实际 Toastr 端口发出合成长提示，方便核对常规矩阵采图时已淡出的通知。

在新 worktree 中按仓库说明准备锁定上游、依赖、Chromium 和隔离受管端口后，可用 `node integrations/sillytavern/scripts/desktop-rebuild-accept.mjs --capture` 重采。命令会写该 worktree 的 `.review-queue/DR2/`，请在临时 worktree 运行，以保留首轮图与本轮交接资料。
