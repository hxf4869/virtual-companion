# Stitch 设计参考与验收记录

> 状态：2026-09-01
> 本文件只登记可以用于新版实现的 Stitch 项目、代表页面和已发现的生成缺陷。未列出的 Stitch 页面都属于
> 探索稿，不能直接交给 AI 实现。

## 使用规则

- Stitch 负责探索视觉方向和代表页面构图，不负责定义产品能力。
- 颜色、字体、间距、圆角和组件规则以 `frontend/DESIGN.md` 的精确令牌为准。
- 页面职责、动作与状态以 `docs/product/frontend-redesign.md` 为准。
- 不复制 Stitch 自动生成的 HTML/CSS；在 uni-app 中使用 Wot UI 基础层与自有产品组件重建。
- 截图中出现溢出、裁切、图标连字、中英文混排、假数据或不可理解术语时，该页面自动失去实现资格，
  必须修正并重新验收。

## 消费者端项目

- 项目：[Virtual Companion Consumer — 2026 Redesign](https://stitch.withgoogle.com/projects/3542461877093874117)
- Project ID：`3542461877093874117`
- Design System：`Warm Familiarity`
- Design System Asset：`assets/0b0c6c3986c8420a96de0962069ead89`
- 参考设备：390px 宽移动端。

### 可用代表页面

| 页面 | Screen ID | 状态 | 截图 |
| --- | --- | --- | --- |
| 首页 - 精简导航版 | `58a3b21fa41742ccb55391689769ea0a` | 已选方向；视觉 QA 通过 | [查看截图](https://lh3.googleusercontent.com/aida/AEtjO1VucrivlQYGRwGsSaYsGWkhoHZSnoosSDRuClrxmJHcZ20djkya0580wFEyJaRodUNUZ7iKLTjB0cqjtF8f9WrRGRJzo4kXdk-cgz0InCOLEDQRVPdW_tbwLydLRj9lfteD92ZDMXkpSdJGUasRMbteyZbamvnPr69Hb81PjpW6RnCOci1nRhI1Dh8QL0GzI2hzcNZAkVuVuyTQ2HPsKM1EqTfFET0_i9HX0NFwJTXWp0faQTG--6Lhq7c) |
| 聊天页 - 精简导航版 | `e90944f4e4794fcfb9cde489809ac529` | 代表页；视觉 QA 通过 | [查看截图](https://lh3.googleusercontent.com/aida/AEtjO1VD-rI6jdT47gketmEKUtrZFQhvJFgeGwRo66l8xVuCVazH2aBheJHSaOv_VKyRVWedu1yRcLu8CipMxlSpWCgH5F9wZCEOL7ShVfZP_yzIBBYtVYdp6LD7b3N39ycHZ4rjTlkm8yGunobJ1UVkpDv9Aqf5Z9nyHNS6rf9x65JUpZvrfw3G2lLfC5LhrJXTPygP9VTirEg7gjGGAJ5Nazip4yGS8ULJGK8I4vxD0uH7NF36QxyiSv0-UA) |
| 登录 - 账号密码 | `1c3b3e7d124148d38329a8edb54c9714` | 代表页；视觉 QA 通过 | [查看截图](https://lh3.googleusercontent.com/aida/AEtjO1WZdY6ahc0aJR1NKFLX90Imk_evzXPQBtiwpO0Fzr5CJx0WMJXav5mnU717JtsyPenmHIOmC8rX4YW8dCkvrU8ef6T3kgxu7UwjLcT_hw4ZOOwrwMv98NpdzJNFgPBkkU8shTOE_sZkwMmxf3w6C5sBwCoClz92Tf7sNAw1Yang9f5WJKOc_7LsoIoyYL-0pom9yqncOdhnwdYQVhObztFF5s84rhvK8wnCCSs2INAet3sp4-Ry6Jhk41s) |
| 登录 - 验证登录 | `cbcd0d3c19ab4433af3526b5c5f26338` | 代表页；视觉 QA 通过 | [查看截图](https://lh3.googleusercontent.com/aida/AEtjO1W6kEZgiA3_CeqI49wv2bjMpf09A3CPL66P-rL0TYnn-Vas1-9It8hltRAGZufIKG-hMdP8DTJAxI4qn0rNjUIxgw7_3WUpk4rk2ZN4Ji9a51rd1icuZ1cSFoKwLQBE9zLOKwQomtiACIUEeroGD9k4qWyPLz4nQ8ncALzsb0QyXvjiHKtA5vFmJJCcwfgLSPdA2jY0pms7yHeB013ndBWSJqzpai7qchC9jF5y6RBEchXkHGZ8cAHdY-E) |

### 首页采用的组合

- 视觉主方向采用“对话正在等你”的关系感与留白。
- 最近对话采用“安静窗景”的紧凑列表，而不是重复大卡片。
- 终板已移除会失效的图标字体，底栏图标使用内联 SVG。
- 底部导航为 52px 三等分轻量栏，背景与页面同为暖象牙色；设计稿不硬编码安全区，真实设备运行时动态增加。
- 全部图标与标签位于设备画布内；首页列表和聊天输入区已完成底部避让。

## 管理后台项目

- 项目：[Virtual Companion Admin — 2026 Redesign](https://stitch.withgoogle.com/projects/16909966535312991065)
- Project ID：`16909966535312991065`
- Design System：`Warm Control Room`
- Design System Asset：`assets/a802f0b0052a49e2b68874dcb1690a83`
- 参考设备：桌面端；Stitch 输出为 1280 × 1024 逻辑画布的 2x 图。

### 可用代表页面

| 页面 | Screen ID | 状态 | 截图 |
| --- | --- | --- | --- |
| 注册审核 - 管理后台（本地化版） | `14d1f5863b0a4bcd9d599857a665ebb8` | 代表页；本地化与视觉 QA 通过 | [查看截图](https://lh3.googleusercontent.com/aida/AEtjO1XMyzQDDY_t3Msx8G61eiluYaEB6DatqpyIcShpVKjbfO9Dk48QcSu_k0t5Y8_t_h0dIus0DbVdLsDr94R6-c7VfOORX3MNJMKZuKdS2-fXl1dfzDGfbWALGQH97plFXbjVzrXjsohnFKF_M0QyLnXeVfzoVqHQkmHg3l32jlZnB4n6F7oSK07-kHNLyxsgSPg_KcNur9LmIk8OicsOiwQzMAX10z4o0uqjv65rG111RtbdH7CbZC7h2BIp) |

后台代表页只确定桌面骨架：232px 侧栏、72px 顶栏、待审核队列、申请详情和批准/拒绝动作。其他三页
必须复用这一骨架，但根据真实任务设计内容，不能复制审核页数据，也不能新增 KPI 卡片填空。

## 已拒绝或被替换的生成结果

| Screen ID | 原因 |
| --- | --- |
| `0ee3ebf2b23d4d29b45bf0702b74aa17` | 方向被采用，但底部切换项存在越界风险，不能实现。 |
| `b8cef2d5694f402c83479de93b6cefc5` | 底栏已修，但图标字体加载失败后显示巨大 `format_quote` 文本。 |
| `e547f606a042481fbdb10c63624512e3` | 越界和图标问题已修，但 64px 纯白底栏视觉占用过大，已由精简导航版替换。 |
| `f35b91e460aa478482fc405fdac4ae59` | 聊天页沿用旧的厚底栏，已由精简导航版替换。 |
| `2115e0c588824c0c94d8c07e7a4ebf02` | 后台布局可用，但导航和主标题中英文混排。 |

## Stitch 页面进入实现前的检查

- 页面内容是否来自产品文档中的真实能力和状态。
- 主要动作是否唯一、可见、使用普通中文。
- 320–430px 移动宽度或目标桌面宽度内是否没有横向溢出。
- 底部导航、输入区、焦点环、阴影和安全区是否完整位于画布内。
- 是否没有图标字体连字、英文占位、假指标和假会话。
- 能否由 Wot UI 基础能力与既定 `vc-*` / `admin-*` 组件实现。
- 如果答案有一项为否，先修设计或更新产品决策，不进入编码。
