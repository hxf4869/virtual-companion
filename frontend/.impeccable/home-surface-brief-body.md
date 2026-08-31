# 首页 Surface Brief

- Scope / mode：`frontend/src/pages/index/index.vue`，Operate。
- Audience：Owner 在 iPhone Safari / Android Chrome 的晚间与日常间隙使用。
- Job：确认当前陪伴仍在、继续上次对话，并一眼看见待确认记忆与提醒状态。
- Primary action：继续聊聊；无关系时等位替换为开始创建陪伴。
- Content proof：真实关系名、最近会话摘要、待确认记忆数量、提醒状态；所有演示数据仅存在于 Stitch 设计稿，不写入生产事实。
- Constraints：始终可见“AI 陪伴 · 非真人”；文字 H5；不暗示语音、图片、恋爱、公开注册或主动推送；一屏一个填充主动作；正文 ≥16px；触摸目标 ≥44px；安全区完整。

## Chosen direction

静默织室 / Quiet Loom。批准构图为“织结平衡版”：一块不对称织物主面板建立陪伴关系，一条连续缝线向下连接会话、记忆与提醒三条开放摘要。批准稿：`frontend/.impeccable/mocks/home/approved-home.png`。

不可照字面复制：织物是材质与连接语法，不是家居照片；不把每个组件都画成布片；不因织纹牺牲对比度；不把 Stitch 图中的演示时间或未命名会话硬编码进产品。

## Implementation inventory

| Ingredient | Sample / commitment | Medium |
| --- | --- | --- |
| Page ground | `#F1F4F1`，全屏安静底色 | semantic CSS token |
| Hero field | `#FEFEFE`，偏左主面板，约占内容首屏三分之一 | semantic HTML/CSS |
| Woven material | 主面板内低对比细密十字织纹，覆盖整块面板，不得以渐变冒充 | generated repeatable raster tile, transparent PNG |
| Relationship mark | 左上小型经纬交叉，8 根以内可数线条 | authored inline SVG |
| Primary action | `#6C56C7`，整宽但不贴边，唯一填充按钮 | semantic button + CSS |
| Continuity seam | 面板下方一条连续紫色细缝线，三个状态结点依次附着 | CSS line + authored SVG nodes |
| Summary rows | 开放行而非浮动卡片；标签、真实摘要、方向图标三层 | semantic buttons + CSS grid |
| Navigation | `#FFFFFF` 固定底栏，四个统一线性 SVG 图标 + 中文标签 | existing navigation semantics + SVG |
| Typography | 中文系统无衬线；陪伴名约 24px/700，正文 16px/1.6，标签 12–13px/600 | CSS type tokens |
| Secondary surface | Stitch 稿摘要区采样约 `#EAEDEB`，仅用于低层级沉面 | semantic CSS token |

## Unresolved

- “虚拟陪伴”仍是工作名；不生成 Logo。
- 正式品牌资产与真实用户素材仍不存在；本轮不编造。
