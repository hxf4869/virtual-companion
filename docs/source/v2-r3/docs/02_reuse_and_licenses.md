# 参考项目、复用方式与许可

查询日：2026-10-27。R3 沿用原项目的同日快照并补查 Stitch / 通知参考。Stars 为当日 API 快照，不能代表中文记忆、稳定性或性能评分。本表把候选分成运行依赖和设计参考，防止一次引入多套完整应用。

## 1. 项目全景与明确推荐

| 项目 | Stars | 栈 / 许可 | 本项目采取的方式 |
|---|---:|---|---|
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 35,012 | JS / Node；AGPL-3.0 | **已确认主产品宿主**，直接保留原生复杂卡行为，主题与扩展页面统一设计 |
| [TavernHelper](https://github.com/N0VI028/JS-Slash-Runner) | 1,380 | 浏览器扩展；PolyForm Noncommercial | 复杂卡运行依赖，锁版本安装 |
| [EjsTemplate](https://github.com/zonde306/ST-Prompt-Template) | 494 | JS 扩展；AGPL-3.0 | 目标卡依赖，锁版本安装 |
| [MVU](https://github.com/MagicalAstrogy/MagVarUpdate) | 154 | TS / 浏览器脚本；MIT | 变量框架直接运行，不另写近似版 |
| [Liyuan](https://github.com/weidu12123/Liyuan) | 289 | TS / Pi；PolyForm Noncommercial | 分支、记忆溯源、回滚设计；有具体必要才许可内选择复用 |
| [dsh-tavern](https://github.com/flizzywine/dsh-tavern) | 1,322 | JS / DSH；AGPL-3.0 | 前后台结算拆分与原文检索参考，不引入第二宿主 |
| [TauriTavern](https://github.com/Darkatse/TauriTavern) | 2,084 | JS 前端 / Rust 后端；AGPL-3.0 | Rust 分层参考，服务器路线不作为主宿主 |
| [AstrBot](https://github.com/AstrBotDevs/AstrBot) | 44,054 | Python；AGPL-3.0 | 主动任务与渠道实现参考；邮箱＋飞书不强制引入完整 AstrBot 运行时 |
| [MaiBot](https://github.com/Mai-with-u/MaiBot) | 6,634 | Python；GPL-3.0，模块另查 | 社交节奏、画像与记忆参考，不整仓集成 |
| [cognee](https://github.com/topoteretes/cognee) | 32,803 | Python；Apache-2.0 | 复杂世界资料和图关系成立时评估 |
| [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | 30,014 | TS；MIT | MemoryCore 是第一外部记忆候选 |
| [AIcove](https://github.com/kuobibulaien/AIcove) | 35 | Flutter / Dart；未发现项目级许可 | 产品与架构参考，不默认复制代码 |
| [Pi](https://github.com/earendil-works/pi) | 118,177 | TS；MIT | 后台 Agent 有明确缺口后评估 |
| [cognee-rs](https://github.com/topoteretes/cognee-rs) | 69 | Rust；MIT OR Apache-2.0 | 早期独立实验，不阻塞当前方案 |

最初提到的“大肥鱼 / 大鲸鱼 / 鲸鱼娘”作为产品体验线索保留；本包没有为这些昵称建立可复核的唯一官方仓库对应，不据此猜测项目身份或 Stars。当前实施依据是用户给出的明确仓库 URL 和上述已核验来源。以后增加特定演示的复刻要求时，先核对原作者与官方仓库；这不阻塞当前已确定方案。

R3：A1/B2/C1/D2 邮箱＋飞书/E3/F2/G2 已明确。上述表格是工程采用方向，不表示每个候选都要安装。当前只读取资料并修订材料，没有安装或运行这些候选。用户允许彻底重构旧模块，复用依据是需求和质量，不强留原实现；存储、数据权利和费用边界同样是选型条件。

### R3 新增的设计与通知参考

| 项目 | Stars 快照 | 许可 | 本版用途 |
|---|---:|---|---|
| [stitch-skills](https://github.com/google-labs-code/stitch-skills) | 8,610 | Apache-2.0 | 参考 design-md、manage-design-system、generate-design，形成 DESIGN.md→Stitch→前端工作流；不是应用运行依赖。 |
| [go-mail](https://github.com/wneessen/go-mail) | 1,503 | MIT | 原 SMTP 实现不适配时优先候选，复用邮件构造、TLS、认证与发送；不从头实现 SMTP。 |
| [飞书 Go SDK](https://github.com/larksuite/oapi-sdk-go) | 623 | MIT | 官方应用消息等能力参考；本版最小群 Webhook 不必为了发一条通知强制依赖全 SDK。 |

新参考固定 commit 见 [锁文件 additional_references](../references/upstreams.lock.json)。它们尚未安装或运行，不以 Stars 证明适配性。

## 2. 先查询再开发：每个新增模块的固定动作

新增能力、架构性阻塞或准备换方案时：

1. 先用仓库搜索查看已实现能力和现有依赖。
2. 查官方规范、官方文档和实际 GitHub 源码；不只读 Stars、README 或二手文章。
3. 保留少量相关候选，优先直接依赖 / 服务接入 / 扩展 / fork。
4. 查许可证、运行依赖、维护状态、API、已有验证和具体缺口。
5. 在一张复用表里记下采用方式与依据；决定自研时写出不适配之处。
6. 已足以判断“怎么接、缺什么、如何验证”就进入实现，不无限检索。

已有实现质量差或背负已取消的产品需求时，可以替换、合并或删除；没有继续使用者的旧接口不保留未来兼容层。性能问题先定位真实瓶颈，不用语言名称替代测量。

不得仅以“统一 Go / Rust”“这个功能不复杂”“AI 能很快写”为由重写成熟宿主。复用决定通常不需要用户审批；只有违背已确认产品方向、用途或需要额外外部授权才升级讨论。

同一版本已有调查直接沿用，不要求每次编辑重复搜索。小范围选型只写表格，不为每个依赖新增 ADR。模板见 [复用记录](../templates/REFERENCE_DECISION.md)。

## 3. 应优先读到具体模块

### SillyTavern

运行基线为正式 1.19.0，commit 7e8663cd9c184a550b37238218bdd32c6efc68e9。研究读取的 release HEAD 06bde939fb1e9c4c8d8641d810f0a916b5bce127 与该 tag 只差发布工作流；实际执行仍核对锁定版本。

从 public/script.js、public/scripts/st-context.js、extensions.js、world-info.js、openai.js、group-chats.js、extensions/regex/engine.js，以及 src/endpoints/chats.js / characters.js、plugin-loader.js、server-main.js 入手。不要按名字猜接口。

已有工具循环优先使用。不要假设 Node 服务天然提供完整无头 Generate；浏览器中的脚本与状态生命周期是真实依赖。

### Liyuan

commit e77238738971a38cac47de782f72143478d89048。

- [card-memory.ts](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/src/card-memory.ts)：常驻摘要、单局回顾、合并手册、来源和后台阶段。
- [memory/service.ts](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/src/memory/service.ts)：scope、当前分支过滤和召回。
- [stage/engine.ts](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/src/stage/engine.ts)：场记、roster、世界状态。

其多角色主要由剧情 Agent 组织群像，不能直接视为每 NPC 秘密隔离。所谓幕后 companion bot 是副编剧讨论线程，不是已经完成的日常主动陪伴。

### dsh-tavern

commit 6befb9203c1ff9ca23788972b14ebe06897d5267。

- [history-recall.js](https://github.com/flizzywine/dsh-tavern/blob/6befb9203c1ff9ca23788972b14ebe06897d5267/tavern-plugin/lib/domain/history-recall.js)：当前已提交故事原文回查。
- [架构](https://github.com/flizzywine/dsh-tavern/blob/6befb9203c1ff9ca23788972b14ebe06897d5267/docs/architecture.md)：前台正文与后台任务。
- stage-director 主要处理立绘 / 音效 / 演出，不是案件真相裁判；card-memory 包主要保存改卡偏好，不等于陪伴日常记忆。

当前 DSH 宿主耦合较深，不能当通用 Go SDK。作者“10秒一轮、95%缓存”等声明没有在本次复测，不能作为性能承诺。

### TauriTavern

commit fff9af0333be97697be2313981699ab0ce35c236。

- [Rust Agent loop](https://github.com/Darkatse/TauriTavern/blob/fff9af0333be97697be2313981699ab0ce35c236/src-tauri/crates/tt-application/src/services/agent_runtime_service/loop_runner.rs)
- [VectorService](https://github.com/Darkatse/TauriTavern/blob/fff9af0333be97697be2313981699ab0ce35c236/src-tauri/crates/tt-application/src/services/vector_service.rs)

是真实 Rust 后端，不只是壳；但是本地宿主和 Node 后端插件兼容有边界，不能因“Rust”就拿它替代本次服务器酒馆方案。其 redb / 精确 cosine 检索不应写成已经具备 ANN / GraphRAG。

### AIcove

commit 946d3977dcf04d8376e42cc0b92f402496583fb3。

- [memory_retrieval.dart](https://github.com/kuobibulaien/AIcove/blob/946d3977dcf04d8376e42cc0b92f402496583fb3/apps/aicove_flutter/lib/src/features/memory/application/memory_retrieval.dart)：core / archive、默认关键词检索、稳定提示前缀。
- [memory_keeper_service.dart](https://github.com/kuobibulaien/AIcove/blob/946d3977dcf04d8376e42cc0b92f402496583fb3/apps/aicove_flutter/lib/src/features/memory/application/memory_keeper_service.dart)：后台整理和进度。
- [proactive_planner.dart](https://github.com/kuobibulaien/AIcove/blob/946d3977dcf04d8376e42cc0b92f402496583fb3/apps/aicove_flutter/lib/src/features/auto_reply/data/proactive_planner.dart)：安静时段、发送窗口、保持沉默和重复话题抑制。

当前默认不是万能向量 / 图谱记忆，Flutter 生命周期也不等于全天服务器。未发现明确项目级许可证，直接代码复用先排除，设计参考可以继续。

### AstrBot / MaiBot

- [AstrBot 主动任务文档](https://github.com/AstrBotDevs/AstrBot/blob/dad255c60f7983fd63c7c0282ded1dde859fbc9a/docs/zh/use/proactive-agent.md)：定时 Agent 和渠道投递，实验能力，不能当全天自主人格。
- [上下文压缩](https://github.com/AstrBotDevs/AstrBot/blob/dad255c60f7983fd63c7c0282ded1dde859fbc9a/astrbot/core/agent/context/manager.py)：截断 / LLM 压缩，不等于长期记忆保证。
- [MaiBot A_Memorix](https://github.com/Mai-with-u/MaiBot/blob/062d45cf8bd4272ac57d7ec03fcf405e5a458211/src/A_memorix/README.md)：vector + graph、事件与人物画像，已与宿主深度集成，旧独立 server.py 已移除。
- [A_Memorix 特许说明](https://github.com/Mai-with-u/MaiBot/blob/062d45cf8bd4272ac57d7ec03fcf405e5a458211/src/A_memorix/LICENSE-MAIBOT-GPL.md)：默认 AGPL，MaiBot 特许不能泛化到本项目。

### MemoryCore / Cognee / Pi

三个项目的详细接入边界见 [记忆与陪伴](05_memory_companion.md)。Pi 的当前仓库为 earendil-works/pi，包前缀为 @earendil-works；不是必须运行编码 CLI 和 Bash 工具才能复用 agent-core。

cognee-rs 是真实 Rust 引擎，但早期项目、构建和组件装配有成本；异步函数也可能等待全流程，不能据语言推断首字更快。

## 4. 非商业自用的许可处置

当前用途允许把 PolyForm Noncommercial 项目纳入其条款许可的候选，但不等于任意再分发、再许可或商业使用。原始许可证和署名需保留，卡片文本、图片、音乐、模型也有独立条件。

- 当前 ST / EJS / dsh / TauriTavern 为 AGPL 系列；若复制或修改后分发 / 提供相关网络服务，按实际条款提供对应源码与声明。
- 当前 Helper 和 Liyuan 主项目为 PolyForm Noncommercial，不能因为内部依赖 Pi 是 MIT 而把产品重新标为 MIT。
- MVU 是 MIT，但它依赖的 Helper 仍有自己的许可。
- AIcove 未明确授权，不把公开仓库当任意复制许可。
- Tencent 根 LICENSE 实际写 MIT，GitHub API 的 NOASSERTION 不是“没有许可”。
- Go 既有代码的 Apache-2.0 标识保留；不要将整个混合目录一概重标 Apache，也不要无理由把互相独立的所有项目重许可。

本包仅包含自写方案和原创输入数据，没有打包上述第三方源码、脚本 bundle 或社区卡。执行时获取第三方代码后建立最小 THIRD_PARTY 记录。将来用途改变时重新核验，当前不因此停止非商业自用开发。

## 5. 版本策略

[upstreams.lock.json](../references/upstreams.lock.json) 保存初始候选 SHA、许可和依赖。构建 / 安装产物下载后补充路径与 SHA256；不预填假 hash。

可在 P1 中因真实兼容问题选择另一明确版本，记录原因和受影响验证即可；不是要求永远停留旧版本。禁止启动时自动 git pull、CDN @master 或不记录的插件自动升级破坏基线。

## 6. R3 必须采用的设计流程与通知复用顺序

### 设计

按 [DESIGN.md](../DESIGN.md) 开始；Google 官方组织的 stitch-skills 提供从描述形成设计系统与生成页面的参考。固定源码：[manage-design-system](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/manage-design-system/SKILL.md)、[design-md](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-utilities/skills/design-md/SKILL.md)、[generate-design](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/generate-design/SKILL.md)、[许可证](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/LICENSE)。

执行环境检查 Stitch 可用性，实际生成桌面与手机稿并保存来源。当前包的两张 PNG 是用户配置参考，不是 Stitch 交付。参考仓库是工具集合，不承诺接口长期不变，不作为强制新增应用后端。

### 邮箱和飞书

先检查现有发信能力是否满足凭据隔离、TLS、错误与重试；能用则复用。否则评估 [go-mail 固定 README](https://github.com/wneessen/go-mail/blob/a9cae6bf332173cc8bf60df5611af6289e66a7dd/README.md) 与 [MIT LICENSE](https://github.com/wneessen/go-mail/blob/a9cae6bf332173cc8bf60df5611af6289e66a7dd/LICENSE)，结合当前 Go 版本选择相容的受维护发行版，不仅为一个库无理由升级整套环境。

飞书默认走官方自定义群机器人 Webhook，使用已有 HTTP 客户端与官方签名规则即可；无明确应用私聊需求时不先搭完整 bot 平台。需要应用消息时再评估 [官方 Go SDK](https://github.com/larksuite/oapi-sdk-go/tree/db9f52d0a88e3f5e4ed81bb34d71a28e3f5608fa) 的 token / 接口实现。官方入口：[自定义机器人使用指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)。

不为两个通知渠道引入完整 AstrBot 的第二套模型、记忆与会话；确有适配复用收益才采用必要桥接。其他渠道不写占位代码，后续真实需求到来再扩展。

### 三模型协议

固定 ST 已有 Chat Completions / Claude 代码先复用；Responses 缺口从现有 repo、成熟客户端及官方接口寻找最小适配。优先阅读 [固定 ST 后端](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/endpoints/backends/chat-completions.js)，并核验最终请求、流事件、工具与 usage。不要把三个协议同时接入三个独立 Agent 框架，也不把 UI 协议下拉当实际支持。
