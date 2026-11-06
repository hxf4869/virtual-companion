# MB2-1 手机性能、组件选型与 App 壳可行性报告

- 日期：2026-11-06（Asia/Shanghai）。
- 状态：报告已交付，停止在 Owner 确认点。严格档性能与部分壳能力 FAIL；真机与引擎净堆等为 NOT_RUN。没有批准选型、调整预算或开始后续实施。
- 代码基线：`mobile-react-rebuild@ff078f4c`；MB2-0 的 `083dc979` 只修订规范与进度，不改变生产运行代码。
- 范围：MB2-1 隔离验证工程；未开始 MB2-2 及之后的产品实施。报告完成后固定停下，等待 Owner。

## 1. 执行范围与证据口径

前端由本机 `/Users/hxf/.local/bin/agy --model gemini-4-argon-high --dangerously-skip-permissions --print-timeout 0 -p "/boost …"` 后台执行。每个会话均带 `/boost`；Owner 已更正 `ai-run` 为另一环境命令，本机不安装该包装器。A/B 使用独立目录与端口，只有调度者整合报告。初轮 B 修正会话启用继续委派后被停止，改为明确 Solo Routine 的会话。多次 CLI 会话停在没有实际子进程的后台等待，已停止；最后一次定向探针会话没有形成修改或可信诊断结果，不计为通过。正式浏览器采样由调度者直接运行现有脚本。

原型在任务 worktree 的 `.mb2-spike/web-a/`、`web-b/`、`native/`。没有把 Spike 入口、原生壳或依赖加入产品目录。测试只用本机合成接口与数据，不调用真实模型、不接生产服务、不发送邮件或飞书。图片另在 MB2-0，不能作为运行或性能证据。

Owner 在本轮明确授权补齐本机模拟器与构建工具。因此安装了 Android API 36、Build Tools 36.0.0、Gradle 8.14.3 与 iOS 27.0 模拟器运行时，使用专用测试设备；没有使用真实签名账号、云打包或推送服务。

## 2. 测量方法

- Chromium 候选统一浏览器可执行文件与 4× CPU 降速。冷轮使用新进程、新空缓存；热轮先完成一次列表、历史与真实引擎预热，再在同 context 测量。正式 A/B 串行执行，各 5 冷 + 5 热，报告样本与中位数 / P95。本文统一使用 nearest-rank P95（5 个样本时为最大值）；B 自动报告原用线性插值，本文从同一批原始样本重新汇总，没有重跑或筛选样本。
- 计时从 Web 页面导航开始，排除 OS / App 进程启动；点击时延从 DOM 点击事件开始。首屏要求真实会话行可见、可点；历史要求实际消息文本进入视口；发送就绪要求共享桥为目标会话的 `prepared` / `ready` / `canSend`，并另用本地合成 provider 实际完成生成断言。点击会话到就绪与导航到就绪分别记录。
- 体积按静态依赖图与实际成功加载资源分别统计，不把已预加载引擎从首屏总数中扣除。gzip 是离线资源压缩体积；本机服务传输条件与真实网络条件分开说明。
- 列表、消息滚动和页面切换分窗口观察，必须确认真实滚动发生；没有样本就记 NOT_RUN / FAIL，不填入假定帧率。
- 堆增量须在可比状态收集 GC 后的样本。含 DOM、历史或卡片的增量不能称为纯引擎增量；不能隔离时，该预算项保留 NOT_RUN。
- 原生模拟器结果与 Chromium 结果分列。没有真机时不宣称真机通过；系统能力的编译、调用返回、实际 UI 操作和回传分别记录。

初轮数据因浏览器 / 预热不同、堆基线不一致及全屏卡片验证不足，仅用于诊断，不能作为最终预算结论。测量修正没有降低严格档目标。

## 3. 性能与卡片结果

### 3.1 Chromium 4× CPU，5 冷 + 5 热

A 在 16:59、B 在 17:05 完成（本地时间），均非零退出，原始失败未删改。以下时延单位为 ms，每格为 **P50 / P95**。两套都使用 200 个合成会话与目标会话 1,000 条历史；同一浏览器二进制，串行测量。界面密度、模拟历史正文和滚动行程不同，因此这是两个完整样板的基线，不是仅替换组件库的性能因果实验。

| 指标 | A 冷 | A 热 | B 冷 | B 热 | 严格档目标 |
|---|---:|---:|---:|---:|---|
| 列表可交互 | 291 / 335 | 269 / 282 | 293.7 / 361.6 | 273.2 / 289.3 | 冷 ≤1,500 / 热 ≤800 ms |
| 点击 → 历史可见 | 144 / 152 | 132 / 148 | 393.5 / 442.6 | 388.9 / 417.9 | ≤300 ms |
| 点击 → 可发送 | 947 / 983 | 749 / 751 | 756.4 / 812 | 737 / 762.7 | 冷 ≤2,500 / 热 ≤1,500 ms |
| 导航 → 可发送（参考） | 1309 / 1434 | 1089 / 1099 | 1079.3 / 1208.8 | 1038.4 / 1071.6 | 仅参考 |

A 三项时延达标；B 列表与发送就绪达标，**历史可见冷 442.6 / 热 417.9 ms 超过 300 ms**。目标会话与 1,000 条消息数均经脚本核对，不能把引擎准备完成等同于全部卡片可操作。

| 体积（gzip bytes） | A | B | 目标 / 说明 |
|---|---:|---:|---|
| 候选静态首屏 JS，实际首行就绪实载相同 | 232,784 | 250,782 | ≤300,000，均 PASS |
| 候选首屏 CSS，实际首行就绪实载相同 | 9,358 | 3,533 | ≤60,000，均 PASS |
| 到 canSend 的累计 JS + CSS | 2,169,286 | 2,181,287 | 动态引擎与运行资源；不能从实际首屏中扣除已加载内容 |
| 未应用 Spike 拆分时的入口 JS 基线 | 1,076,214 | 1,055,428 | 初轮构建记录，包含静态引擎；只作拆分依据 |

体积 PASS 仅属于 **Spike 构建期变换后的候选**：把共享 `session-bridge.ts` 的运行模块改为动态导入，并延后自动准备。生产源文件未修改，这一结果不代表当前生产入口已达到预算。HTTP 回环服务未 gzip 压缩、未限网络；gzip 数字是离线逐文件计算，启动时延不能外推到移动网络。

| 4× CPU 采样窗口 | A 帧间隔 P50 / P95 ms | A >50ms 长任务 | B 帧间隔 P50 / P95 ms | B >50ms 长任务 |
|---|---:|---:|---:|---:|
| 列表滚动 | 16.7 / 16.7 | 0 | 16.7 / 16.7 | 0 |
| 消息滚动 | **33.3 / 50.0** | 0 | 16.7 / 16.7 | 0 |
| 页面切换 | **16.7 / 233.3** | **3** | 16.7 / 16.7 | 0 |

A 消息滚动与切换 **FAIL**，B 在本次三个窗口达标。均确认实际 scroller 位移，但 A / B 的采样窗与滚动距离不同（如消息 A 约20,156 px，B约2,247 px），不能将差值归因于 Ionic 本身。两套的真实跟手侧滑均为 **NOT_RUN**；点击返回不能代替它。

同一历史页、GC 后，从运行模块加载前到就绪的堆增量：A **20,387,892 B**，B **19,423,792 B**；列表至整个对话就绪增量分别约22.5 MB、21.5 MB。加载期间同时发生 `cards.renderMessage` DOM 写入，未隔离纯引擎分量，因此 **≤15 MB 的纯引擎预算为 NOT_RUN**，不把这些混合增量冒充 PASS 或引擎本身的超标证据。

### 3.2 复杂卡与全屏卡

| 验证 | A | B | 结论边界 |
|---|---|---|---|
| 共享桥、真实运行模块与可发送状态 | PASS | PASS | 非固定延时或静态就绪标记 |
| MVU 初始 / 最新楼层 / 历史快照 | 定向复验 PASS：最新10→15，历史第0楼保持10 | 数值为10→15，历史第0楼保持10；EJS前后条件均正确 | B 总断言仍 FAIL：脚本还要求打开前整个 document 的 iframe 数为0，实际为1；静态契约确认 Helper 使用独立 TH-script-- iframe，消息卡为 TH-message--；该全局计数不能证明消息卡重复，也不能声称 MVU值更新失败或整卡通过 |
| 独立 EJS 显示与生成 | 文本求值、真假分支、无原始标签、嵌套生成均 PASS；DOM属性探针为空导致整项 FAIL | 等待显示文本及 iframe 的组合条件超时 | A 初轮的原始模板问题由合成设置漏 `regex: []` 导致，补齐后已恢复；B 全屏 MessageLeaf 缺少锁定 EJS 所需的 `.mes[mesid]` 祖先，选择器找不到宿主即提前返回；是本次样板集成缺陷，不是共享引擎已失效 |
| 真库弹层内单一实例往返 | 定向复验 PASS | FAIL / 完整往返受阻 | A 使用 IonModal keepContentsMounted；B 使用 Base UI Dialog.Portal keepMounted。A 脚本关闭弹层后尝试点击隐藏 iframe 内按钮而超时，属于验收流程缺陷；定向复验按正常入口重新打开后通过。B定向检查中关闭按钮被MVU版本Toast拦截，未清理DOM或修改pointer-events绕过 |

候选已经改为库弹层真正承载 `MessageLeaf`，没有通过空弹层加外置 fixed 卡片、关闭焦点管理或修改 pointer-events 绕过操作。A独立复验确认首次打开只有1个消息iframe、点击计数0→2、关闭后输入及发送按钮可用、重开后window/document标记与计数保留，并确认MVU最新15 / 历史10。A的EJS显示文本无原始模板，但DOM探针元素确实不存在，原脚本整项FAIL保留。B另行直达EJS卡实测：`.mes[mesid="0"] .mes_text` 匹配数0、iframe存在、原始模板仍可见，证实宿主契约缺失。**B的卡片完整验收尚未成立**；需要补齐现有消息宿主契约与Toast层级，并修正总iframe计数探针。此处按暂停条件保留失败，不继续扩展产品实现。

### 3.3 原生 WebView 性能

每个方案与冷 / 热模式各一个正式样本，不作 P95 推断。首屏从 WebView 导航起算，历史和引擎从可信首行点击起算；驱动启动和等待另记，不混入页面性能。已验证原生平台、HTTPS、安全上下文、目标会话、1,000 条历史及实际滚动位移。

| 平台 / 方案 | 冷 / 热 | 首屏 ms | 历史 ms | 引擎 canSend 标记 ms | 对话滚动 fps / 最大帧间隔 ms |
|---|---|---:|---:|---:|---:|
| Android A | 冷 | 892.7 | **987.3** | 1,353.6 | 59.97 / 16.8 |
| Android A | 热 | 739.9 | **463.1** | 804.8 | 33.53 / **100** |
| Android B | 冷 | 825.9 | **555.1** | 1,041.0 | 34.14 / **150** |
| Android B | 热 | **821.0** | **329.1** | 329.3 | 42.12 / **83.3** |
| iOS A | 冷 | **4,614** | **506** | 868 | 54.26 / **55** |
| iOS A | 热 | 214 | **361** | 362 | 60.10 / 35 |
| iOS B | 冷 | 194 | **447** | 447 | 57.43 / 39 |
| iOS B | 热 | 190 | **380** | 380 | 58.13 / 42 |

**8 轮历史均超300 ms，iOS A冷首屏超1,500 ms，Android B热首屏超800 ms。** Android A的两轮在输入后的发送按钮可用断言超时（exit 1），所以其 `canSend` 标记不能冒充完整发送就绪 PASS；B两轮该断言通过（exit 0）。iOS表中为运行时标记，未把真实输入并发送另作完整验收。

Android 从页面开始到滚动完成的长任务各1次，A冷/热最大83/90 ms，B冷/热95/71 ms；观察窗口包含导航与引擎准备，不能全部归因于滚动。WK不提供这里使用的 Long Tasks / heap 数据，两项 NOT_RUN。原生仅采对话滚动，没有补造列表滚动与转场指标。

iOS首轮因XCTest错误寻找StaticText而未能点击。最小修正为在已通过DOM命中测试的首行中心执行真实触摸后，定向重测两案冷/热，exit 0；首轮失误记录保留且不混入正式样本。性能采集退出0只代表数据收齐，不代表预算通过。两端热轮均先完整预热列表→历史→引擎→返回，再重启测量。

Android B冷/热页面堆差23.24/23.48 MiB含UI和历史，不能用于引擎净堆预算；iOS真机 NOT_RUN。HTTPS性能relay去除了认证请求头与响应Cookie，不验证生产登录，专用Cookie试验另见第5节。


## 4. 组件比较

| 项目 | A：Ionic React | B：无样式组合 |
|---|---|---|
| 核心版本 | `@ionic/react` / router `9.0.10`，React Router `6.30.4` | Base UI `1.9.0`、Vaul `1.1.2`、Motion `14.9.1`、use-gesture `10.3.1`、Virtuoso `4.18.20` |
| React 19 | 上游 peer 支持；路由要求 `>=6.4 <7` | 锁定依赖构建与React 19样板运行通过；卡片集成问题另列 |
| 页面栈 / 侧滑 | Ionic 提供页面栈与交互式返回；手机路由与桌面 TanStack 路由分别作为入口 owner | TanStack Router、Motion 与 use-gesture 提供路由/动画/输入原语，现有组合没有完整手机页面栈和跟手返回；按 §3.8 不手写补齐 |
| 抽屉与维护 | 官方组件与 Capacitor 同体系；默认主题需映射现有 token | Vaul 作者已声明停止维护，且引入 Radix Dialog；与已有 Base UI 的焦点/滚动锁 ownership 需核对 |
| 列表 | 两边均使用 Virtuoso | 两边均使用 Virtuoso |
| 结论 | 建议作为后续验证的优先候选，暂不批准产品采用 | 当前组合缺完整页面栈与侧滑容器，且 Vaul 停止维护，不建议直接定为后续唯一方案 |



**还原度不是 PASS。** 已查看同为390×844 CSS视口的列表浅深截图：A 更接近极光底、独立行卡和悬浮导航，但仍是四个错误导航项及 emoji 图标，未符合规范的五项线性图标；B 有未经规范允许的在线点、紫色主色、双行预览和调试入口。最终补拍已统一390×844、像素比1，等待历史正文可见和有限路由动画结束；两套的示例数据及版式密度仍不同，截图仅作设计差异检查，不作像素一致性证明。最终审核仍由 Claude / Owner 完成。

| 计划 §3.8 真实条目 | A / B 本轮证据 | 后续采用前的缺口 |
|---|---|---|
| 1. 现成交互 | A 有 Ionic 页面栈、Modal、TabBar、ItemSliding；B 有库 Dialog/Drawer/Virtuoso | A 真实侧滑未验；B 无完整手机页面栈，标签栏仍是样板按钮；并非全部控件已覆盖 |
| 2. 动态视口与四边安全区 | 静态 CSS；原生探针两平台 inset 样本 | 不等于两套实际页面的完整刘海 / 导航栏矩阵通过 |
| 3. 键盘 | 原生独立探针 Android adjustResize、iOS native 通过稳定竖横屏样本 | A/B 产品输入栏与键盘组合未验 |
| 4. 最窄320、触控44 | 两套 Chromium 抽查320、390、横屏与折叠视口无横向溢出，已测控件≥44 | 尚非每页、每状态全覆盖 |
| 5. 系统字体 | 浏览器 CSS 1.3× 局部检查 | Android系统字体与iOS动态字体 NOT_RUN |
| 6. 容器查询与设备类别 | 有容器查询，未发现该候选用 innerWidth 分支 | App大平板入口与类别切换 NOT_RUN |
| 7. 禁止补丁式布局 | 候选静态检查 | 不能代替真实几何验证 |
| 8. 方向与状态保持 | 有横屏样本 | 旋转后草稿及阅读位置、通话和剧情 NOT_RUN |
| 9. 模式与角色主题 | 浅深样板截图 | 自动模式和角色主题覆盖未完整验证；上述还原度差异未验收 |
| 10. 减弱动态 | 候选有 CSS / Motion 相关设置 | 动效终态实际交互证据不足，NOT_RUN |

因此推荐是**有条件优先验证 A**，理由是具备计划需要的手机交互原语、与 Capacitor 配套；不是性能或视觉已通过。暂不建议放宽严格档，也不能根据这批带测量缺口的数据决定转 React Native。先由 Owner 决定是否接受继续验证与后台能力的产品边界。

证据：[Ionic 9.0.10 发布](https://github.com/ionic-team/ionic-framework/releases/tag/v9.0.10)、[peer 范围](https://github.com/ionic-team/ionic-framework/blob/v9.0.10/packages/react-router/package.json)、[导航文档](https://ionicframework.com/docs/react/navigation)、[IonContent 安全区](https://ionicframework.com/docs/api/content#safe-area-padding)、[Vaul 维护声明](https://github.com/emilkowalski/vaul)、[Motion](https://github.com/motiondivision/motion)、[use-gesture](https://github.com/pmndrs/use-gesture)。

## 5. 双平台壳结果

环境：macOS 27.0.1 / arm64；Capacitor 8.6.0。Android 为官方 Pixel 7 / Android 16（API 36）AOSP arm64 AVD，4 vCPU、2 GiB RAM、WebView 133.0.6943.137；iOS 为 iPhone 17 / iOS 27.0（24A434）模拟器。两端实际安装并加载本机 HTTPS `/m/`，未连接真实账户或生产登录。

| 项目 | Android | iOS | 证据与限制 |
|---|---|---|---|
| 构建、安装与 HTTPS 启动 | PASS | PASS | `cap sync`；Android OpenJDK 23.0.2 在线预热后离线 APK 构建；Xcode 27.0 宿主与 Share Extension 本地模拟器 ad-hoc 构建 |
| Cookie 保持 | PASS 恢复/稍后冷启；FAIL 即刻强退 | PASS 冷启/恢复 | Android 设置 Cookie 后约 1 秒强退曾丢失；稍后两次冷启保持。测试的是合成 Secure/HttpOnly Cookie，非生产登录链路 |
| getUserMedia | PASS 拒绝及静音授权 | FAIL 模拟器拒绝路径；真机 NOT_RUN | Android 补齐探针 `MODIFY_AUDIO_SETTINGS` 后，关闭宿主输入的虚拟设备获得 1 条静音音轨并即停。iOS 撤销权限后仍返回活跃轨；未录制/存储/上传，也未确认 iOS 输入源静音，后续未继续收音 |
| 键盘 / resize | PASS 稳定竖横屏 | PASS 竖横屏 | Android `adjustResize`：竖屏可见高815→520 CSS px、输入底520；横屏可见161.14、输入底161.06，resize 初始瞬态曾206。iOS `native`：输入距键盘竖44.48 pt、横17.0 pt |
| 系统返回 / 侧滑 | PASS 返回键 | FAIL WK 同文档历史侧滑 | Android `#child` → Back 触发 popstate；iOS 边缘拖动保持原 hash。该失败不能替代 Ionic 页面栈实测 |
| 安全区 | PASS 三键/手势 | PASS iPhone17 竖横屏 | Android 屏宽1080、可用 y 范围三键[136,2276]、手势[136,2337]；本轮以 SystemBars 为唯一 inset owner。其余设备矩阵仍待后续 |
| 通知快捷回复 | PASS | FAIL 模拟器操作 | Android 真实通知 RemoteInput 回传合成文本匹配；须 `isExactNotification:false` 避免无必要的精确闹钟设置。iOS 通知已到达，但实测操作未展开回复动作，不能推断插件无此能力 |
| 锁屏正文 / 泛化标题 | PASS 未见正文；泛化标题 NOT_RUN | NOT_RUN | Android 确认 keyguard showing=true，既未见正文也未见预期泛化标题；不把“无泄露”当作完整通知验收 |
| 分享接收 | PASS 文本/图片 | PASS 图片 | Android 系统图库授权分享后文件真实复制99 B；直接 adb URI 不具权限的用例不算通过。iOS Photos → Share Extension → 发布 → 手动返回宿主收到1附件；文本/链接与真机签名待验 |
| 恢复刷新 | PASS | PASS | Home 后激活，App 插件触发同源刷新，合成 Cookie 保持 |
| Android 后台30分钟持续流 | **FAIL** | 不适用 | 361帧最终齐收，但发生25分钟级停止交付，见下表 |
| 来电全屏 / iOS前台来电页 | NOT_RUN | NOT_RUN | 产品通话页属 MB2-12/13；本轮没有伪造系统推送能力 |
| 真机矩阵 | NOT_RUN | NOT_RUN | 模拟器无法替代 OEM 后台、真实麦克风权限与 iOS 签名/物理设备验证 |

**Doze 失败可复现。** 14:23:28 启动前台服务并按 Home，14:23:50 强制 deep IDLE，14:53:43 确认仍为 IDLE 且前台服务仍运行，14:53:44 唤醒取样。流通过模拟器虚拟网卡 HTTPS，而非 adb reverse；整个等待窗没有附加 DevTools，App 未加入白名单。

| 观测 | 数值 |
|---|---:|
| 最终帧数 / 乱序 | 361/361 / 0 |
| 客户端总时长 | 1,815.995 s |
| 最长无帧到达间隔 | **1,515,755 ms（25分15.8秒）** |
| Doze 内仍持续到达的帧间隔 | 56个，中位5,001.5 ms，最大5,006 ms |
| 唤醒后补到的帧间隔 | 300个，中位0 ms |

脚本成功读取结果不等于能力 PASS。客户端记录证明交付暂停，不能单凭本次数据区分 Android 网络、WebView renderer 或二者共同原因。该失败触发计划 §9，不能通过放宽阈值、加入白名单或改记“最终收齐”消除。Android 临时 deep-idle、导航 overlay、PIN 和锁屏预览设置已恢复。

系统证据参考：[Android Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)、[Foreground Service](https://developer.android.com/develop/background-work/services/fgs/service-types)、[Keyboard](https://capacitorjs.com/docs/apis/keyboard)、[App 返回与恢复](https://capacitorjs.com/docs/apis/app)、[Apple 通知动作](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions)。本地逐帧元数据与原生定向测试记录将在交付目录保留。

## 6. 依赖、许可与维护

所有候选先在隔离工程登记固定版本与许可证，再安装。生产 `package.json` 和 `scripts/checks/license-inventory.yaml` 未变。官方 Capacitor、Ionic、React Router、Virtuoso、Vaul、Motion、use-gesture 为 MIT；既有锁定引擎许可仍按仓库约束保留。

| 原生候选 | 本轮固定版本 | 许可与维护 |
|---|---|---|
| Capacitor core/cli/android/ios、SwiftPM | 8.6.0 | MIT，官方维护 |
| App / Keyboard | 8.1.2 / 8.0.6 | MIT，官方维护 |
| Local Notifications / Haptics | 8.3.1 / 8.0.2 | MIT，官方维护 |
| Status Bar / community Safe Area | 8.0.4 / 8.0.1 | MIT；核查未安装，当前探针使用 v8 SystemBars，避免重复 inset owner |
| Capawesome Android Foreground Service | 8.1.0 | MIT，上游 v8 active support |
| Capgo Share Target | 8.0.65 | MPL-2.0；根许可证/包声明为准，README 页脚的 MIT 不作为结论 |

Capgo 的 MPL-2.0 在仓库全局 allowlist 中，但不在 ST 集成域 allowlist；若正式采用，须明确产品依赖归属、登记与 notices，不能以本次隔离安装替代准入。社区 safe-area 文档要求与核心 SystemBars 选择唯一 inset owner，不同时叠加 StatusBar / 多层补偿。

来源：[Capacitor](https://github.com/ionic-team/capacitor/releases/tag/8.6.0)、[官方插件](https://github.com/ionic-team/capacitor-plugins)、[Local Notifications 8.3.1](https://www.npmjs.com/package/@capacitor/local-notifications/v/8.3.1)、[SystemBars](https://capacitorjs.com/docs/apis/system-bars)、[Safe Area](https://github.com/capacitor-community/safe-area)、[前台服务](https://capawesome.io/docs/sdks/capacitor/android-foreground-service/)、[Share Target 许可证](https://github.com/Cap-go/capacitor-share-target/blob/main/LICENSE)。

## 7. 需 Owner 确认的边界

1. 组件和严格预算在最终数据齐备后确认。本报告不自动批准 MB2-2 及之后条目。
2. Capacitor 官方将 `server.url` 定位为 live reload、非生产用途。远程 `/m/` 探针可验证技术行为，但正式壳的支持与可信 origin / 卡片 iframe 原生桥隔离需单独确认。不能把本机匿名夹具测试等同于生产登录链路。[官方配置](https://capacitorjs.com/docs/config)
3. iOS 不接推送时，已排程的本地通知与“网页挂起后发现新的后台事件”是两种能力；后者不能由本地通知替代。Share Extension 本轮验证用户手动回到宿主后消费，不承诺扩展直接唤起宿主。[Apple 扩展边界](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html)
4. Android Doze 持续流已经 FAIL；需选择允许锁屏后暂停并回前台“继续”，或保留硬门槛并另行验证能够满足的运行条件。iOS 侧滑/回复/权限和真机未完成项不能按通过继续推进。

## 8. 验证命令与交付

以下命令在任务 worktree 的隔离工程执行。生产目录没有新增手机入口或依赖；本次提交仅报告、TODO 与 Backlog，因此没有再跑无关的生产全量回归。

| 命令 / 范围 | 状态 |
|---|---|
| `npm --prefix .mb2-spike/web-a test`、`run typecheck`、`run build` | PASS；约束6项、组件3项。静态测试不代表§3.8完整验收 |
| `npm --prefix .mb2-spike/web-b run test:unit`、`run build` | PASS；组件8项 |
| `node --check`：A/B服务与测量、原生perf JS | PASS |
| `npm --prefix .mb2-spike/web-a run measure` | FAIL（exit1）；5冷+5热已采齐，保留长帧及卡片流程失败 |
| `npm --prefix .mb2-spike/web-b run measure` | FAIL（exit1）；5冷+5热已采齐，保留历史超标及卡片失败 |
| 定向卡片 / 稳定截图脚本 | A实例往返与MVU PASS；B关闭Toast遮挡FAIL；B EJS缺陷已复现，截图采集完成 |
| Capacitor同步、Android离线 `assembleDebug`、iOS模拟器宿主及Share Extension构建 | PASS |
| `node perf/android.mjs A cold`、`A warm` | FAIL（输入后发送按钮断言）；已采阶段单列 |
| `node perf/android.mjs B cold`、`B warm` | 采集PASS，性能预算FAIL |
| iOS `NativeWebViewPerformanceTests` 定向测试 | 修正驱动后采集PASS，性能预算FAIL；原始exit65保留 |
| Android Doze 30分钟试验 | FAIL（持续交付要求），最终361帧收齐不能替代 |
| iOS真机、原生完整设备/字体矩阵、纯引擎净堆 | NOT_RUN |
| 文档差异、引用与 `git diff --check` | PASS（提交前检查） |

正式Chromium命令显式设置 `MB2_CHROMIUM_EXECUTABLE` 到本机 `chromium-1248` 的 Google Chrome for Testing，均为4×CPU；未运行真实provider。原生命令、工具版本与复现步骤保留在本地归档的 `native/README.md` 和 `native-results.md`；iOS使用 `xcodebuild ... -only-testing:SpikeUITests/NativeWebViewPerformanceTests test`，Android构建使用 OpenJDK 23 与已预热的Gradle离线缓存。

本地交付目录 [`.review-queue/MB2-1/NOTES.md`](../../.review-queue/MB2-1/NOTES.md) 已保留：最终A/B JSON及自动报告、同视口比较截图、原生精简证据和隔离验证源码归档。自动报告中的§3.8旧条目映射与个别总判定存在上文说明的问题，以本文真实十条对照和原始数据为准，不覆盖原始失败。只保留这一轮最终资料与必要失败记录；专用模拟器、证书私钥与临时测试数据已删除，通用SDK保留，构建目录已随临时worktree回收。报告提交不包含截图、Spike产品原型、真实数据或凭据。
