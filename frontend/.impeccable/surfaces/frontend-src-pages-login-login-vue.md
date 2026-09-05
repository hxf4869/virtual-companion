---
version: 1
slug: "frontend-src-pages-login-login-vue"
primary_target: "frontend/src/pages/login/login.vue"
related_targets: []
---

# 认证入口 Surface Brief

- Scope / mode：`frontend/src/pages/login/login.vue` 及其直接使用的 `vc-auth-*` 组件，Operate。
- Audience：普通用户在手机 H5 登录，并为以后同一套消费者组件生成微信小程序保留结构兼容。
- Job：用账号（用户名或邮箱）和密码进入服务端指定的验证步骤，完成日常 TOTP、首次身份验证器设置或恢复码登录。
- Primary action：随当前步骤唯一变化为“继续”“验证并登录”“验证并开启”或“我已保存，进入首页”。
- Content proof：注册开关、`nextStep`、短时 challenge、身份验证器二维码、恢复码和会话均来自真实 Go Runtime；页面不自行猜测准入状态。
- Constraints：注册关闭时只显示“注册暂未开放”；无底部导航；challenge 只存内存；登录账号接受用户名或邮箱且不做邮箱格式强制校验；验证码由真实 input 支撑粘贴与自动填充；“信任此设备 90 天”默认未选中且不免账号和密码；不展示请求 ID、状态码或内部术语。

## Chosen direction

Warm Familiarity / 熟悉的温度。沿用已验收 Stitch 登录构图：暖象牙全屏底、单列窄表单、左对齐标题与说明、陶土色唯一主动作；验证步骤使用返回动作和六格验证码。页面不是悬浮卡片，也不使用旧版噪点、织纹、技术 Alpha 标识或底部白色底座。

## Implementation inventory

| Ingredient | Sample / commitment | Medium |
| --- | --- | --- |
| Page ground | `--vc-color-canvas`，覆盖动态视口与真实安全区 | semantic CSS token |
| Brand mark | 小型陶土色圆点与中文工作名，不生成或伪造正式 Logo | semantic HTML/CSS |
| Auth shell | 最大 430px 的单列内容；320–430px 自适应，宽屏居中 | `vc-auth-shell` |
| Credentials | 持续可见“账号 / 密码”标签、原生可访问 input、文字化密码显隐 | `vc-auth-field` |
| One-time code | 六格视觉与一个真实 input；支持粘贴、系统自动填充和键盘焦点 | `vc-totp-code-input` |
| Setup | 真实二维码、手工密钥、验证码确认、默认不选的可信设备 | `vc-authenticator-setup` |
| Recovery codes | 单列真实代码、复制全部、确认保存后进入首页 | `vc-recovery-code-card` |
| Foundation | Wot UI v2 的 ConfigProvider 与 Button；产品结构和字段仍由 `vc-*` 定义 | Wot UI + product components |

## Unresolved

- “虚拟陪伴”仍是工作名；本轮只使用文字标记，不制作正式品牌资产。
- 邮件服务和公开注册尚未接通；即使前端读取注册开关，也不创建失效的注册链接。
