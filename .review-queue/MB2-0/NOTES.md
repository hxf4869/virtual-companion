# MB2-0 设计图交接

2026-11-06。**候选已出齐；视觉审核 NOT_RUN，Owner 选图 NOT_RUN。** 本目录按 Owner 2026-11-06 授权，仅提交到 `review/mb2-0-images` 审图分支，不合入 `mobile-react-rebuild`。

- 共37页面/版式，浅深各一张，共74张。全部来自内建 imagegen；完整提示词、编辑输入和文件对应见 [PROMPTS.md](PROMPTS.md)。
- 风格沿用 MB-1 已选极光、玻璃控件与 Apple 应用语法。剧情舞台 A 为场景优先、B 为时间线优先；折叠屏 A 留较宽列表、B 留较宽对话，均用底部导航。
- 电脑端窄窗入口以 DR2/review-2 的真实合成截图编辑，仅加入口行；不把电脑端重画成手机页面。
- 图片为版式提案，生成尺寸不等于实际设备 CSS 像素；页面实施仍须按 DESIGN.md 数值和 MB2 §3.8/§6 做几何、交互、性能验收。横屏、折叠屏尺寸按各图比例表达。
- 内容核对修正了旧示例中并不存在的多剧目/难度/手工存档、提醒完成与重复、用量日周统计、渠道送达/核验、酒馆字段归属等。当前剧情是《雨夜旅馆：失踪的怀表》，回档按版本新分支处理。
- 初步自查仍可见生成偏差：部分模板/用量组带多余头像，部分卡片/标题装饰和图标在浅深图中不完全一致，局部字体与示例文本可能偏离。它们不作为实现要求；请 Claude 在 REVIEW.md 按页面明确保留或需重出，不能由本说明代替审核。

Claude 审核请创建或填写 `REVIEW.md`，Owner 之后填写 `PICKS.md`。本分支仅含候选图、提示词、索引与 MB2-1 对比截图；未选图的页面不进入实现。后端与不依赖新图的条目在 `mobile-react-rebuild` 独立推进。

MB2-1 同视口对比截图见 [comparison-stable](../MB2-1/comparison-stable/)：390×844、DPR1，8张列表/对话浅深截图及3张卡片截图。它们是合成数据的运行样板，不是MB2-0选图候选；对应缺陷与测试范围见仓库中的MB2-1报告。

## 当前候选

| 页面 | 变体 | 浅色 | 深色 |
|---|---|---|---|
| 剧情列表 | A | [查看](images/story-list/A-light-v2.png) | [查看](images/story-list/A-dark-v2.png) |
| 剧情开局向导 | A | [查看](images/story-start/A-light-v2.png) | [查看](images/story-start/A-dark-v2.png) |
| 剧情舞台 | A | [查看](images/story-stage/A-light-v2.png) | [查看](images/story-stage/A-dark.png) |
| 剧情舞台 | B | [查看](images/story-stage/B-light.png) | [查看](images/story-stage/B-dark.png) |
| 剧情线索墙 | A | [查看](images/story-clues/A-light.png) | [查看](images/story-clues/A-dark.png) |
| 剧情回档 | A | [查看](images/story-rollback/A-light.png) | [查看](images/story-rollback/A-dark.png) |
| 酒馆配置列表 | A | [查看](images/tavern-list/A-light.png) | [查看](images/tavern-list/A-dark.png) |
| 酒馆回复配置 | A | [查看](images/tavern-reply/A-light-v2.png) | [查看](images/tavern-reply/A-dark-v2.png) |
| 酒馆提示词格式 | A | [查看](images/tavern-formatting/A-light.png) | [查看](images/tavern-formatting/A-dark.png) |
| 酒馆世界书 | A | [查看](images/tavern-worldinfo/A-light.png) | [查看](images/tavern-worldinfo/A-dark.png) |
| 酒馆扩展 | A | [查看](images/tavern-extensions/A-light.png) | [查看](images/tavern-extensions/A-dark.png) |
| 酒馆人设 | A | [查看](images/tavern-personas/A-light.png) | [查看](images/tavern-personas/A-dark.png) |
| 酒馆背景 | A | [查看](images/tavern-backgrounds/A-light.png) | [查看](images/tavern-backgrounds/A-dark.png) |
| 酒馆界面 | A | [查看](images/tavern-interface/A-light.png) | [查看](images/tavern-interface/A-dark.png) |
| 酒馆API连接 | A | [查看](images/tavern-api/A-light.png) | [查看](images/tavern-api/A-dark.png) |
| 酒馆角色卡 | A | [查看](images/tavern-character/A-light.png) | [查看](images/tavern-character/A-dark.png) |
| 酒馆全屏代码编辑 | A | [查看](images/tavern-code/A-light.png) | [查看](images/tavern-code/A-dark.png) |
| 收藏 | A | [查看](images/memory-favorites/A-light.png) | [查看](images/memory-favorites/A-dark.png) |
| 提醒 | A | [查看](images/memory-reminders/A-light.png) | [查看](images/memory-reminders/A-dark.png) |
| 日记 | A | [查看](images/memory-diary/A-light.png) | [查看](images/memory-diary/A-dark.png) |
| 记忆时间线 | A | [查看](images/memory-timeline/A-light.png) | [查看](images/memory-timeline/A-dark.png) |
| 记忆纠正 | A | [查看](images/memory-correction/A-light.png) | [查看](images/memory-correction/A-dark.png) |
| 陪伴投递记录 | A | [查看](images/companion-delivery/A-light.png) | [查看](images/companion-delivery/A-dark.png) |
| 陪伴通知渠道 | A | [查看](images/companion-channels/A-light.png) | [查看](images/companion-channels/A-dark.png) |
| 角色创建向导 | A | [查看](images/character-create/A-light.png) | [查看](images/character-create/A-dark.png) |
| 人设编辑 | A | [查看](images/persona-edit/A-light.png) | [查看](images/persona-edit/A-dark.png) |
| 模型提供方 | A | [查看](images/models-provider/A-light.png) | [查看](images/models-provider/A-dark.png) |
| 模型用途绑定 | A | [查看](images/models-bindings/A-light.png) | [查看](images/models-bindings/A-dark.png) |
| 模型用量 | A | [查看](images/models-usage/A-light.png) | [查看](images/models-usage/A-dark.png) |
| 表情包管理 | A | [查看](images/stickers/A-light.png) | [查看](images/stickers/A-dark.png) |
| 建议回复与状态卡 | A | [查看](images/suggestions-status/A-light.png) | [查看](images/suggestions-status/A-dark.png) |
| 全屏卡片页 | A | [查看](images/card-fullscreen/A-light.png) | [查看](images/card-fullscreen/A-dark.png) |
| 折叠屏双栏 | A | [查看](images/foldable/A-light.png) | [查看](images/foldable/A-dark.png) |
| 折叠屏双栏 | B | [查看](images/foldable/B-light-v2.png) | [查看](images/foldable/B-dark-v2.png) |
| 横屏对话 | A | [查看](images/landscape-chat/A-light.png) | [查看](images/landscape-chat/A-dark.png) |
| 横屏通话 | A | [查看](images/landscape-call/A-light.png) | [查看](images/landscape-call/A-dark.png) |
| 电脑端窄窗手机版入口 | A | [查看](images/desktop-mobile-entry/A-light-v2.png) | [查看](images/desktop-mobile-entry/A-dark-v2.png) |
