# 复杂酒馆卡兼容执行规范 · R3

核验日期：2026-10-27。范围为用户已确认的 **1A 服务端 Web/H5、2C 复杂酒馆卡与扩展优先、3C 非商业自用**。本文件是静态源码研究，不代表已安装运行或通过浏览器兼容验收。

当前仅修订材料，未启动安装或运行。用户已确认 A1 原生 ST 主产品、B2 首版含 P5、C1 原生文件存储边界、F2 全保存版本检查、G2 按用途固定模型，以及 E3 不迁移旧聊天。首版通知为邮箱＋飞书。具体模型、凭据和费用上限留到运行配置，不构成本包未决产品取舍。

## 1. 已选运行路线与设计约束

保留真实 SillyTavern 浏览器界面、前端消息/提示词/渲染生命周期与 Node 服务；以扩展和少量可追踪补丁加入陪伴能力。不要在新 Vue 前端模拟全部酒馆 API，不要将宏/世界书/正则/MVU 翻译为一套 Go 或 Rust 的近似实现。

第一阶段要跑通“原生 ST + 锁定版本的 TavernHelper + EJS + MVU”的自有复杂卡，然后才接入长期记忆。新增记忆不能破坏原有发送、接收、渲染、变量落盘和分支行为。

前端遵循 [DESIGN.md](../DESIGN.md)：先统一设计规范，再由 Stitch 形成桌面与手机页面设计稿，随后实现。设计任务与原生复杂卡最小技术验证可以并行；正式前端页面应以设计稿为依据。实现优先采用 ST 主题、原有组件和新增扩展页面，不因 Stitch 输出某种框架代码就替换 ST 宿主。视觉调整不能删除目标插件依赖的生命周期、接口或消息身份。

A1＋E3 允许退役旧 Vue/uni-app 主入口，首版不承担微信小程序与旧聊天展示；仅为它们预留的适配代码无需继续建设。

## 2. 当前版本与许可证（实际文件核验）

| 组件 | 版本/分支 | 固定提交 | 许可 | 备注 |
|---|---|---|---|---|
| SillyTavern | 正式发布 1.19.0 | `7e8663cd9c184a550b37238218bdd32c6efc68e9`（tag） | AGPL-3.0 | 推荐运行基线；release HEAD 为 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，与 tag 仅相差 `.github/workflows/npm-publish.yml` |
| TavernHelper / JS-Slash-Runner | manifest 4.11.3，main | `0af421068e7c03b6b0a71b68feb79d201164edeb` | **PolyForm Noncommercial 1.0.0** | manifest 最低 ST 1.13.0；声明最低版本不等于当前组合已验收 |
| ST-Prompt-Template / EjsTemplate | manifest 1.17.9，main | `d6f520d149aba146305b0b781ddd691d449c28d2` | AGPL-3.0 | 独立扩展，提供 EJS 条件、变量、注入与渲染 |
| MagVarUpdate / MVU | beta 与 master 当前同一 SHA | `d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc` | MIT | 基于 TavernHelper 的脚本；不要把 package.version 当兼容版本，按 commit 与 bundle hash 锁定 |
| tavern_helper_template（可选） | main | `ee3c768ab5d12412115084851bc224c3e0d8a5e5` | PolyForm Noncommercial 1.0.0 | 脚本/前端编写模板，不是运行时必需组件 |

第三方检索结果存在 TavernHelper 为 AFPL 的旧记录；当前实际 LICENSE 已核实为 PolyForm Noncommercial，必须以固定版本许可证为准。

使用 [upstreams.lock.json](../references/upstreams.lock.json) 一处保存 repo、ref、commit、version、license、artifact path/hash、requires、verifiedAt。运行安装采用不可变 SHA；升级是显式动作，通过与变更相关的兼容样例再更新锁文件。不在运行启动时自动 git pull，不在 MVU import 中固定引用 `@master`。

MVU 教程用 CDN `@master/artifact/bundle.js`。执行实现应改成 SHA 固定地址或自托管该固定产物，保留原有许可证；这是锁版本适配，不是改写其运行逻辑。记录第三方依赖的独立许可，不将整个混合目录标成 Apache-2.0，也不将“非商业自用”解释为不受许可约束。卡片文本、插画、音乐等资源单独确认授权；自有 fixtures 不复制社区人物和素材。

## 3. 安装与初始化依赖

1. 安装并运行固定 ST；使用持久化数据目录和自己的账号。安装范围先限本人的用户目录。
2. 安装固定 TavernHelper 扩展，验证版本与基础消息/变量 API。
3. 安装固定 ST-Prompt-Template，验证 `EjsTemplate` 与条件模板；它与 Helper 是独立扩展，不能只装其中一个就声称都有。
4. 在自有复杂测试卡中安装并启用固定 MVU 脚本及对应世界书、正则。MVU 当前 `src/main.ts` 检查 TavernHelper >= 3.4.17。
5. 读取 Mvu 前等待初始化事件/`waitGlobalInitialized('Mvu')`，不要用任意固定 sleep 掩盖竞态。
6. 启用本项目的陪伴扩展/桥接插件，然后跑相同 fixtures；比较启用前后最终 prompt、原始消息、显示文本和变量结果。

关系：ST → 原生宏/世界书/正则/STscript；ST → TavernHelper → MVU；ST → EjsTemplate；复杂卡可以同时依赖上述多项。`SillyTavern`、`TavernHelper`、`EjsTemplate`、`Mvu` 是不同 API surface，不得混用同名方法。

## 4. 兼容矩阵：沿用真实宿主，并逐项验收

| 能力 | 当前源代码证据 | 新项目执行要求 | 不可过度承诺的边界 |
|---|---|---|---|
| V2/V3 PNG | ST parser 读 PNG 优先 `ccv3` 后备 `chara`，写入实际同时生成两种 chunk | 用原生导入导出；比较重要字段和 `extensions` 元数据 | 顶部旧注释写“仅 chara”，与实际实现不同；以函数为准；V3 marker 不证明 V3 每项完整语义 |
| JSON 角色卡 | `src/endpoints/characters.js` 存在 `importFromJson`，导出分支有 PNG/JSON | 自有 JSON/PNG 交叉导入验证人设、开场、世界书与扩展字段 | 导出 JSON 调用 `getCharaCardV2`，不能承诺任意 V3 文档完整无损 round-trip |
| CHARX | `src/charx.js` 解析 card.json、头像和 auxiliary assets，导入端持久化表情/背景等资源 | 加一个自有小 CHARX 导入 fixture，核对资源实际显示 | 当前原生 export 分支为 PNG/JSON；不要承诺 CHARX 原样导出、所有外部宿主资产或脚本语义 |
| 世界书 | `public/scripts/world-info.js` 包括扫描、递归、预算、sticky/cooldown/delay 等 | 保留原生引擎；测试关键词、常驻、次级条件、递归、预算与定时效果代表场景 | 私密角色知识不是普通共享世界书天然具备的权限能力 |
| 预设与宏 | 原生 prompt manager、macros 及 definitions | 验证角色/用户宏、对象变量、提示词顺序与模型参数映射；通过请求捕获看最终 prompt | 不用 Go 再替换一遍宏，不把参数预设和提示词预设混成一类 |
| 正则 | `regex/engine.js` 区分 placement、markdownOnly、promptOnly、runOnEdit、depth | 同时检查存储原文、显示文本、发送内容；避免对原文重复做破坏性替换 | 只做字符串替换不能代表完整正则兼容 |
| STscript / Quick Reply | 原生脚本与快捷回复系统 | 用一段自有变量管道和快捷回复验收，保留宿主解析器 | 不把它当通用 JavaScript，也不当成 MVU |
| TavernHelper HTML/JS | Helper 使用 iframe 和宿主 API；manifest 指向真实打包产物 | 测试状态栏读当前楼层变量、按钮事件、跨角色切换和重新打开 | iframe 不是强安全沙箱；本轮目标为本人可信内容，不扩成公开不可信脚本 SaaS |
| EJS | prompt 前处理与消息后渲染都可修改变量/注入内容 | 验证条件片段、变量读取、render 与 generate 分支各执行预期次数 | 不把 `<% ... %>` 原样喂给模型就算兼容 |
| MVU | 解析模型更新、持久化 `stat_data`，依赖 chat/message/swipe 身份 | 当前消息变量、初始化、替代开场、更新、reload、swipe 后状态都要验收 | MVU 有可选额外模型/Pi 路径，首版只选一种更新方式，不默认同时开启本项目第二套变量更新 |
| 群聊 | ST 支持 NATURAL/LIST/POOLED/MANUAL 和角色卡 swap/join | 先用原生群聊，不重写四种策略；验证指定角色和停止 | 原生群成员共享历史，不等于严格剧本杀秘密隔离 |
| 编辑/重生成/swipe/分支 | ST 1.19 发布说明特别涉及 branch/checkpoint integrity；MVU 更新校验 swipe_id | 记忆和故事事件必须绑定当前有效回复/分支，过时异步结果不能回写 | 删除消息/换 swipe 不能留下另一份当成事实的长期记忆 |

## 5. 服务端主动陪伴与复杂卡生命周期的重要边界

MVU 是浏览器脚本。当前 `src/main.ts` 使用 jQuery、window、SillyTavern，监听 CHAT_CHANGED，pagehide 时卸载；`on_message_received.ts` 等待 MESSAGE_RECEIVED/CHARACTER_MESSAGE_RENDERED 并写回变量。服务器在无人打开网页时直接写 JSONL，不会自动执行这些链路。

因此：

- 后台可以生成并持久化主动互动的待投递内容、跟进事项和未读状态。
- 页面恢复后，通过 F2 版本检查保护的全部保存路径投递和确认，查重并处理当前链接状态；不能把后台文件 append 当成插件执行成功。
- 对普通长期陪伴可以使用明确的服务器文本生成路径，但该路径的能力说明不能冒充复杂卡完整 runtime。
- 任意复杂卡的无人值守剧情推进，不作为“安装 ST 后自然具备”的能力；先让其在活跃宿主中成立。以后若确需无浏览器运行，再评估真实宿主 worker 等方案，禁止一开始复制全部前端逻辑到 Go。
- MVU 的异步额外模型更新会等待渲染，再写回。本项目记忆抽取不能只监听最早的 MESSAGE_RECEIVED 就立即把暂态内容认作最终事实。
- 普通复杂卡模式，ST/MVU 拥有聊天与变量权威；本项目只做映射/派生记忆。严格剧情模式的权威世界状态属于故事引擎，卡片 MVU 状态只读映射或经明确命令校验，避免两个写者争用同一状态。

## 6. 自有 fixtures 与必要验证

用户没有给现成卡，不应成为阻塞。先创作原创、简短、自带公开测试素材的 fixtures：

| fixture | 内容 | 验收重点 |
|---|---|---|
| C01 基础卡 | 同一人设的 JSON、PNG；两条开场；角色世界书；自定义 extensions 标记 | 导入、选择开场、导出后字段仍在，模型请求里的角色/用户名正确 |
| C02 世界书 | 常驻、关键词/次级条件、递归、预算冲突和 cooldown 的最小条目集 | 捕获每轮实际激活条目、顺序和最终发送内容；随机概率用100%/0%确定样例 |
| C03 宏/预设/正则 | `{{char}}`/`{{user}}`、一个聊天变量、显示专用与prompt专用正则 | 原文、界面和请求三者按规则不同；编辑后无重复执行 |
| C04 复杂状态卡 | Helper iframe 状态面板 + EJS 条件 + MVU 初始 trust=10 | 固定模型回复更新到15；状态栏、下一轮提示词、持久化均为15 |
| C05 时间线 | C04的另一个 swipe 更新到8；编辑、重生成、分支与回开 | 当前分支与当前swipe正确；异步旧结果不能写回；长期记忆没有两份互斥“事实” |
| C06 CHARX | 自制card.json、简单头像、一个表情及背景资源 | 原生导入后资源映射正确；不要求原样 CHARX 导出 |
| C07 群聊 | 三张原创简单卡 | 指定发言、自然顺序/停止、角色身份正确；不宣称天然秘密隔离 |
| C08 主动消息 | 后台待投递问候，在浏览器关闭时产生 | 重开查重后进入宿主生命周期，F2 保护全部后续保存；主动删除不补投；邮箱/飞书通知分别验收 |

先用本地 stub provider 返回固定内容、捕获最终请求，验证编排与状态；再在实际模型、用途和总预算配置完整后做少量真实体验。G2 是已确认的配置策略，不等于任何具体模型费用已经授权；已配置密钥本身不构成费用授权。stub 结果不能背书中文长期记忆效果或真实首字性能。使用真实浏览器执行 UI 与插件，DOM/截图确认状态栏可见；不能仅 HTTP 200、JSON能解析或后端单测通过就宣布复杂卡完成。

首轮只要求上述代表路径。后续修改只回归受影响 fixtures；不上全套无关压测、不把每次小改都变成全量门禁。未来用户提供目标卡时追加为授权样本，不自动下载无许可的社区内容。

## 7. 一手来源

- ST 正式发布：https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.0
- ST tag 与 release 差异：https://github.com/SillyTavern/SillyTavern/compare/7e8663cd9c184a550b37238218bdd32c6efc68e9...06bde939fb1e9c4c8d8641d810f0a916b5bce127
- ST PNG parser：https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/character-card-parser.js
- ST 导入导出：https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/characters.js
- ST CHARX：https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/charx.js
- ST 世界书：https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js
- ST 正则：https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js
- ST 群聊：https://docs.sillytavern.app/usage/core-concepts/groupchats/
- ST 扩展：https://docs.sillytavern.app/for-contributors/writing-extensions/
- Helper manifest：https://github.com/N0VI028/JS-Slash-Runner/blob/0af421068e7c03b6b0a71b68feb79d201164edeb/manifest.json
- Helper LICENSE：https://github.com/N0VI028/JS-Slash-Runner/blob/0af421068e7c03b6b0a71b68feb79d201164edeb/LICENSE
- Helper 各API surface：https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/功能详情/访问酒馆接口或其他插件.html
- EJS manifest：https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/manifest.json
- EJS文档：https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/README_CN.md
- MVU README：https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/README.md
- MVU 初始化/生命周期：https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/main.ts
- MVU 接收后处理：https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/function/update/on_message_received.ts
- MVU 实际Mvu API：https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/function/global/index.ts
- MVU 安装与条目：https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/doc/tutorial.md

## 8. 本包输入与执行状态

[原创样例入口](../fixtures/README.md) 提供基础角色卡、记忆案例、短剧情数据和复杂卡制作配方。基础 JSON 仅作为输入种子；C04 的 Helper/EJS/MVU 运行卡必须在锁定的真实宿主中制作、验证、导出并加入仓库。不要把配方文档当成已跑通的复杂卡。

版本组合当前状态为 NOT_RUN。所有 runtime hash、截图、最终请求捕获和 PASS 状态由执行 Agent 在真正运行后填写。未来获授权实施后，缺少真实模型配置/预算不阻塞固定provider的宿主集成，但真实模型效果和延迟保持 BLOCKED / NOT_RUN。

## 9. 三种协议的实现与兼容范围

用户截图已经确定三协议配置：**Anthropic Messages、OpenAI Chat Completions、OpenAI Responses**。三者都要进入首版实际调用路径，不能只实现下拉选项，也不能把其中两个自动推迟到后续。

| 协议 | 固定 ST 1.19.0 的静态依据 | 本版工程要求 |
|---|---|---|
| Anthropic Messages | Claude 路径构造 `/messages` 请求并设置对应 headers | 优先复用现有路径；自定义 base、模型 ID、输出限制、系统消息、流和工具结果以真实请求验证 |
| OpenAI Chat Completions | Custom 路径按 `custom_url` 发送 `/chat/completions`，支持自填模型 ID | 优先复用原生路径；保证本项目用途绑定与最终请求一致 |
| OpenAI Responses | 在固定版本后端生成路径中未发现 Responses 请求实现；前端相关注释不能证明已支持 | 先查现有成熟实现，再补最小必要适配；请求、流事件、工具调用、usage、取消和错误都需要语义映射 |

静态依据：[ST 后端生成](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/endpoints/backends/chat-completions.js)、[ST 前端配置](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/scripts/openai.js)。这些是源码分析，未运行复现任何协议故障。

统一配置入口显示最终请求地址，处理 base 中已有 `/v1` 或完整路径的情况，避免重复拼接。模型输入类型、结构化输出、搜索、系统消息、推理等级等能力分别记录用户声明和已验证支持；不支持的能力明确禁用或提示，不能静默改协议、换模型或丢掉关键参数。详见 [模型配置样例](../fixtures/model_profiles.json)。

三协议各覆盖一组代表性的流、取消、工具结果和最终上下文验收，不做所有扩展与所有模型的笛卡尔积测试。P5 在三协议的实际出站请求位置验证角色知情边界，包含工具后续轮次；实现替换或补丁不能绕过 F2、来源核对、C1 和用途预算。
