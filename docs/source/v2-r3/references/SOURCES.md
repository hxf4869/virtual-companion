# 一手来源索引

**抓取与静态核验基准：2026-10-27（Asia/Shanghai）。** 本页是源码与官方文档导航，选型结论见[复用与许可](../docs/02_reuse_and_licenses.md)，运行边界见[架构](../docs/03_architecture.md)和[酒馆兼容](../docs/04_tavern_compatibility.md)。

仓库页面和在线文档会继续变化；固定提交链接用于复核本包依据。Stars 仅为上述日期的 GitHub API 快照，不是效果、性能或稳定性测评。不得将作者演示或自报性能当成本次测试结果。

[upstreams.lock.json](upstreams.lock.json) 记录已核验的真实源码 SHA、版本、许可和依赖关系。**它是候选源码锁定记录，不是已验证的安装组合：当前运行状态为 `NOT_RUN`。** 构建或下载后再填写实际产物路径、SHA256 和运行证据；不得预填虚构 hash 或 PASS。下列设计参考项目不因此成为必须安装的依赖。

## 1. 现有 virtual-companion 基线

固定 main：`baa26f7bd2cf50f23058b030e1bc690a5fb553d4`。

- [仓库固定快照](https://github.com/hxf4869/virtual-companion/tree/baa26f7bd2cf50f23058b030e1bc690a5fb553d4)；[产品约定](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/PRODUCT.md)；[Go 运行时决策](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/docs/decisions/0007-go-companion-runtime.md)。
- 记忆召回证据链：[LoadSeed / SelectRecallMemories](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/generation.go) → [有效记忆 SQL](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V132__recall_effective_memory.sql) → [上下文构建](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/turn/builder.go)。
- [异步记忆提取](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/memory_extract.go)；[单活跃关系约束](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V9__relationship_active_companion_limit.sql)；[维护调度器](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/scheduler.go)。
- 性能与运行边界：[并发配置](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/config/config.go)、[单实例租约](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/lease.go)、[既有 fake-provider 报告](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/docs/planning/g12-go-capacity-sample.md)。具体审查见[现有代码审查](../docs/01_existing_audit.md)。

## 2. SillyTavern 官方文档与规范

| 主题 | 一手入口 | 使用目的 |
|---|---|---|
| 角色设计 | [Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) | 人设字段、开场、示例对话、覆盖提示词 |
| 角色卡 V2 | [Character Card V2 规范](https://github.com/malfoyslastname/character-card-spec-v2) | 字段、内嵌世界书、扩展元数据 |
| 角色卡 V3 | [Character Card V3 规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) | V3 与资产格式；不能把规范定义等同宿主全部支持 |
| 世界书 | [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) | 激活、作用上下文、顺序、预算和高级行为 |
| 宏 | [Macros](https://docs.sillytavern.app/usage/core-concepts/macros/) | 替换与变量语义 |
| 正则 | [Regex](https://docs.sillytavern.app/extensions/regex/) | 显示、prompt、作用位置与顺序 |
| STscript | [STscript](https://docs.sillytavern.app/usage/st-script/) | Slash command、管道、变量与脚本运行环境 |
| 群聊 | [Group Chats](https://docs.sillytavern.app/usage/core-concepts/groupchats/) | 调度和共享历史边界 |
| UI 扩展 | [Writing Extensions](https://docs.sillytavern.app/for-contributors/writing-extensions/) | 上下文 API、事件、生命周期与浏览器依赖 |
| 服务端插件 | [Server Plugins](https://docs.sillytavern.app/for-contributors/server-plugins/) | 同源桥接路由、装载和服务权限 |
| 多用户与认证 | [Multi-user](https://docs.sillytavern.app/administration/multi-user/) | 用户上下文与实际认证的区别，首版保留Go密码＋TOTP入口 |
| 可信头登录 | [SSO](https://docs.sillytavern.app/administration/sso/) | 受控反代映射已有ST账号；仍需每请求认证与会话绑定 |
| 代理认证子请求 | [Nginx auth_request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) | 复用现有认证校验，不引入另一套身份平台 |

### 固定宿主版本与源码入口

- [正式发布 1.19.0](https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.0)：运行候选 tag SHA `7e8663cd9c184a550b37238218bdd32c6efc68e9`；[固定许可证](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/LICENSE)。
- [tag 与研究 release HEAD 的差异](https://github.com/SillyTavern/SillyTavern/compare/7e8663cd9c184a550b37238218bdd32c6efc68e9...06bde939fb1e9c4c8d8641d810f0a916b5bce127)：仅发布工作流不同。下列源码使用实际读取的 release HEAD，应用源码与候选 tag 一致。
- 导入与资产：[PNG parser](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/character-card-parser.js)、[角色导入导出](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/characters.js)、[CHARX](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/charx.js)。
- 前台运行：[Generate 主流程](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)、[上下文 API](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js)、[扩展拦截器](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js)、[Chat Completions](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js)。
- 内容运行：[世界书引擎](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js)、[正则引擎](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js)、[群聊调度](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js)。
- 服务端：[聊天持久化](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js)、[插件装载](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/plugin-loader.js)、[中间件与路由顺序](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/server-main.js)、[服务端事件](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/server-events.js)。
- 认证边界：[可信头自动登录与既有session行为](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/users.js)、[socket来源解析](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/express-common.js)。

## 3. 复杂卡运行依赖

| 组件与固定 SHA | 版本 / 许可来源 | 接入源码与文档 |
|---|---|---|
| [TavernHelper](https://github.com/N0VI028/JS-Slash-Runner/tree/0af421068e7c03b6b0a71b68feb79d201164edeb) `0af4210…` | [manifest 4.11.3](https://github.com/N0VI028/JS-Slash-Runner/blob/0af421068e7c03b6b0a71b68feb79d201164edeb/manifest.json)；[PolyForm Noncommercial](https://github.com/N0VI028/JS-Slash-Runner/blob/0af421068e7c03b6b0a71b68feb79d201164edeb/LICENSE) | [README](https://github.com/N0VI028/JS-Slash-Runner/blob/0af421068e7c03b6b0a71b68feb79d201164edeb/README.md)；[Helper 官方文档](https://n0vi028.github.io/JS-Slash-Runner-Doc/) |
| [EjsTemplate](https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2) `d6f520d…` | [manifest 1.17.9](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/manifest.json)；[AGPL-3.0](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/LICENSE) | [中文 README](https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/README_CN.md) |
| [MVU](https://github.com/MagicalAstrogy/MagVarUpdate/tree/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc) `d03b7dc…` | [MIT](https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/LICENSE)；[安装与变量教程](https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/doc/tutorial.md) | [初始化及 pagehide](https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/main.ts)；[消息、渲染、swipe 校验](https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/function/update/on_message_received.ts)；[Mvu API](https://github.com/MagicalAstrogy/MagVarUpdate/blob/d03b7dc8a6ebf9bd611c7e2dc91f3b35462deebc/src/function/global/index.ts) |
| [Helper 开发模板，可选](https://github.com/StageDog/tavern_helper_template/tree/ee3c768ab5d12412115084851bc224c3e0d8a5e5) `ee3c768…` | [PolyForm Noncommercial](https://github.com/StageDog/tavern_helper_template/blob/ee3c768ab5d12412115084851bc224c3e0d8a5e5/LICENSE) | 开发参考，不是运行前置依赖 |

## 4. 用户提供的产品与框架参考

此处与下一节合计覆盖用户给出的全部参考项目；用途边界以[复用与许可](../docs/02_reuse_and_licenses.md)为准。

| 固定仓库快照 | 优先阅读的模块 |
|---|---|
| [Liyuan — e77238738971a38cac47de782f72143478d89048](https://github.com/weidu12123/Liyuan/tree/e77238738971a38cac47de782f72143478d89048) | [卡级记忆](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/src/card-memory.ts)、[分支与 scope](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/src/memory/service.ts)、[许可证](https://github.com/weidu12123/Liyuan/blob/e77238738971a38cac47de782f72143478d89048/LICENSE) |
| [dsh-tavern — 6befb9203c1ff9ca23788972b14ebe06897d5267](https://github.com/flizzywine/dsh-tavern/tree/6befb9203c1ff9ca23788972b14ebe06897d5267) | [已提交剧情回查](https://github.com/flizzywine/dsh-tavern/blob/6befb9203c1ff9ca23788972b14ebe06897d5267/tavern-plugin/lib/domain/history-recall.js)、[任务拆分架构](https://github.com/flizzywine/dsh-tavern/blob/6befb9203c1ff9ca23788972b14ebe06897d5267/docs/architecture.md) |
| [TauriTavern — fff9af0333be97697be2313981699ab0ce35c236](https://github.com/Darkatse/TauriTavern/tree/fff9af0333be97697be2313981699ab0ce35c236) | [Rust 工具循环](https://github.com/Darkatse/TauriTavern/blob/fff9af0333be97697be2313981699ab0ce35c236/src-tauri/crates/tt-application/src/services/agent_runtime_service/loop_runner.rs)、[向量服务](https://github.com/Darkatse/TauriTavern/blob/fff9af0333be97697be2313981699ab0ce35c236/src-tauri/crates/tt-application/src/services/vector_service.rs) |
| [AstrBot — dad255c60f7983fd63c7c0282ded1dde859fbc9a](https://github.com/AstrBotDevs/AstrBot/tree/dad255c60f7983fd63c7c0282ded1dde859fbc9a) | [主动任务](https://github.com/AstrBotDevs/AstrBot/blob/dad255c60f7983fd63c7c0282ded1dde859fbc9a/docs/zh/use/proactive-agent.md)、[上下文压缩](https://github.com/AstrBotDevs/AstrBot/blob/dad255c60f7983fd63c7c0282ded1dde859fbc9a/astrbot/core/agent/context/manager.py) |
| [MaiBot — 062d45cf8bd4272ac57d7ec03fcf405e5a458211](https://github.com/Mai-with-u/MaiBot/tree/062d45cf8bd4272ac57d7ec03fcf405e5a458211) | [A_Memorix](https://github.com/Mai-with-u/MaiBot/blob/062d45cf8bd4272ac57d7ec03fcf405e5a458211/src/A_memorix/README.md)、[模块特许的适用边界](https://github.com/Mai-with-u/MaiBot/blob/062d45cf8bd4272ac57d7ec03fcf405e5a458211/src/A_memorix/LICENSE-MAIBOT-GPL.md) |
| [AIcove — 946d3977dcf04d8376e42cc0b92f402496583fb3](https://github.com/kuobibulaien/AIcove/tree/946d3977dcf04d8376e42cc0b92f402496583fb3) | [记忆注入与检索](https://github.com/kuobibulaien/AIcove/blob/946d3977dcf04d8376e42cc0b92f402496583fb3/apps/aicove_flutter/lib/src/features/memory/application/memory_retrieval.dart)、[主动规划](https://github.com/kuobibulaien/AIcove/blob/946d3977dcf04d8376e42cc0b92f402496583fb3/apps/aicove_flutter/lib/src/features/auto_reply/data/proactive_planner.dart)；未发现项目级许可，不能据公开可读推断代码复用授权 |

## 5. 记忆与 Agent 候选

| 固定仓库快照 | 直接关联本项目的证据 |
|---|---|
| [TencentDB-Agent-Memory — 084bed45cad6bb7f877455082cee82835d65671a](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/084bed45cad6bb7f877455082cee82835d65671a) | [MIT LICENSE](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/084bed45cad6bb7f877455082cee82835d65671a/LICENSE)、[v3 API](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/084bed45cad6bb7f877455082cee82835d65671a/MemoryCore/v3-api-memorycore-doc.md)、[画像 scope](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/084bed45cad6bb7f877455082cee82835d65671a/MemoryCore/src/core/profile/profile-scope.ts)、[跨 session 去重过滤](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/084bed45cad6bb7f877455082cee82835d65671a/MemoryCore/src/core/record/l1-extractor.ts)、[存储后端](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/084bed45cad6bb7f877455082cee82835d65671a/MemoryCore/src/core/store/factory.ts) |
| [Cognee — 37f788bd287750e10d7610173e5332b3843f6ebd](https://github.com/topoteretes/cognee/tree/37f788bd287750e10d7610173e5332b3843f6ebd) | [remember](https://github.com/topoteretes/cognee/blob/37f788bd287750e10d7610173e5332b3843f6ebd/cognee/api/v1/remember/remember.py)、[recall](https://github.com/topoteretes/cognee/blob/37f788bd287750e10d7610173e5332b3843f6ebd/cognee/api/v1/recall/recall.py)、[forget](https://github.com/topoteretes/cognee/blob/37f788bd287750e10d7610173e5332b3843f6ebd/cognee/api/v1/forget/forget.py) |
| [Pi — 177e2ad7e41e85c16c859f844a0569a3c76f2666](https://github.com/earendil-works/pi/tree/177e2ad7e41e85c16c859f844a0569a3c76f2666) | [Agent API 与 hooks](https://github.com/earendil-works/pi/blob/177e2ad7e41e85c16c859f844a0569a3c76f2666/packages/agent/README.md)、[实际 Agent loop](https://github.com/earendil-works/pi/blob/177e2ad7e41e85c16c859f844a0569a3c76f2666/packages/agent/src/agent-loop.ts)；使用当前 `earendil-works/pi` 仓库 |
| [cognee-rs — b97e1d5f934b94ef8d0dbd3e7e7078ded8abfe88](https://github.com/topoteretes/cognee-rs/tree/b97e1d5f934b94ef8d0dbd3e7e7078ded8abfe88) | [组件装配与嵌入存储说明](https://github.com/topoteretes/cognee-rs/blob/b97e1d5f934b94ef8d0dbd3e7e7078ded8abfe88/README.md)、[实际 remember 流程](https://github.com/topoteretes/cognee-rs/blob/b97e1d5f934b94ef8d0dbd3e7e7078ded8abfe88/crates/lib/src/api/remember.rs)、[Cargo 许可声明](https://github.com/topoteretes/cognee-rs/blob/b97e1d5f934b94ef8d0dbd3e7e7078ded8abfe88/Cargo.toml) |

详细接入要求见[记忆与陪伴](../docs/05_memory_companion.md)。只选择满足当前缺口的候选；不要为了比较而同时长期运行全部方案。

## 6. 使用本索引

执行 Agent 从当前模块相关链接开始，先读实际实现与固定版本许可。只有发现版本变化、接口缺口或准备引入新方案时补充检索；已有证据可复用。新增结论记入[复用决策模板](../templates/REFERENCE_DECISION.md)，实际产物和验证状态更新锁文件与阶段证据，避免把本页扩成重复报告。


## 7. R2评审补充的一手依据

这些来源用于静态能力核验和设计范围，未据此宣称应用故障已经复现。

| 主题 | 固定源码或官方入口 | 用途 |
|---|---|---|
| ST服务器明文边界 | [官方多用户说明](https://docs.sillytavern.app/administration/multi-user/) | 聊天、API Key与文件系统访问范围 |
| ST聊天与备份 | [固定chats.js](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/endpoints/chats.js) | 全量JSONL保存、integrity/force、独立删除/导入路径、读取错误与备份 |
| ST秘密文件 | [固定secrets.js](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/endpoints/secrets.js) | secrets.json与迁移备份，展示限制不等于落盘加密 |
| Go应用层加密 | [FieldCipher](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/store/postgres/fieldcipher.go) | AES-GCM信封及现有调用契约；部署实际状态未检查 |
| 旧Go导出 | [export.go](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/jobs/export.go) | 现有数据域与可复用任务，不自动覆盖ST |
| 删除与导出清理 | [account.go](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/httpapi/account.go)、[V103](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V103__durable_account_deletion_intent.sql)、[V137](https://github.com/hxf4869/virtual-companion/blob/baa26f7bd2cf50f23058b030e1bc690a5fb553d4/backend/internal/migrate/sql/V137__export_cleanup_during_deletion.sql) | 复用持久删除意图、晚到任务屏障、导出对象清理 |
| Web Push（R2 候选，R3 非首版渠道） | [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) | Service Worker、订阅与后台接收，区别于应用inbox |
| iOS/iPadOS Web Push（历史候选） | [WebKit官方说明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) | 原 Web Push 候选资料；R3 D2 已选邮箱＋飞书，不要求额外实现浏览器推送 |

日期运算样例采用公历、Asia/Shanghai和明确的ISO周约定，是本包确定性输入。真实相对表达有歧义时澄清，不用样例约定替用户猜测。

## 8. R3 设计、三协议与邮箱 / 飞书来源

以下为 2026-10-27 新增研究。API 与在线文档可能变动，实际实施核对对应版本；所有方案仍未运行。原有项目 Stars 快照不因本版文档修订自动刷新。

| 主题 | 一手来源 | 采用范围 |
|---|---|---|
| DESIGN.md | [Google 官方介绍](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) | 设计语义文件与跨工具复用；本包采用 DESIGN.md，不另造设计规范体系。 |
| Stitch 工作流 | [固定 stitch-skills](https://github.com/google-labs-code/stitch-skills/tree/0337446dadde6f8c94210444e2aa9d546126480f)、[设计系统](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/manage-design-system/SKILL.md)、[页面生成](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/generate-design/SKILL.md)、[Apache-2.0](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/LICENSE) | 实施时检查工具可用性，设计系统→桌面 / 手机稿→前端；并非当前已生成。 |
| ST 协议实现 | [后端](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/src/endpoints/backends/chat-completions.js)、[前端](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/scripts/openai.js) | Claude / Custom 原生路径与 Responses 缺口的静态依据，不是运行测试。 |
| OpenAI Responses | [官方 Create Response](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) | 独立请求对象、输出与流 / 工具语义，不能只替换 Chat Completions URL。 |
| Anthropic Messages | [官方 Messages API](https://platform.claude.com/docs/en/api/messages/create) | messages / content blocks / system / tools 与 API 版本；按实际版本核对 headers。 |
| Go 邮件库 | [README](https://github.com/wneessen/go-mail/blob/a9cae6bf332173cc8bf60df5611af6289e66a7dd/README.md)、[MIT LICENSE](https://github.com/wneessen/go-mail/blob/a9cae6bf332173cc8bf60df5611af6289e66a7dd/LICENSE)、[官方使用文档](https://go-mail.dev/) | 原有邮件模块不合适时的候选，复用构造与 SMTP / TLS 能力。 |
| 飞书群 Webhook | [官方自定义机器人使用指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN) | 当前群的通知出口，与应用私聊 / 双向聊天不同；根据实际配置与业务响应验收。 |
| 飞书官方 SDK | [README](https://github.com/larksuite/oapi-sdk-go/blob/db9f52d0a88e3f5e4ed81bb34d71a28e3f5608fa/README.md)、[MIT LICENSE](https://github.com/larksuite/oapi-sdk-go/blob/db9f52d0a88e3f5e4ed81bb34d71a28e3f5608fa/LICENSE) | 应用接口需要时再使用，不强制为简单 Webhook 加完整 SDK。 |

截图来源为用户本轮上传：[协议参考](../fixtures/model_config_protocols.png)、[模型字段参考](../fixtures/model_config_details.png)。它们不包含真实凭据，按原图保留，未宣称为本产品已经实现的页面。

R3 不重复调研未选的微信 / 企业微信 / QQ 实施范围，不据它们的文档新增首发适配器。后续用户确有需求时再核查当时官方与成熟实现，不沿用过期限制。

严格剧情的远端上下文边界另参见 [OpenAI Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)：previous_response_id 与 conversation 可延续历史。本版采用显式 ActorView 的最小方案，不把当前 payload 检查或 store:false 单独当隔离证明。
