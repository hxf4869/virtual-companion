# 语音消息与语音输入计划（2026-10-31）

Owner 决定（2026-10-31 问答）：日常问候等允许等待的语音用 CosyVoice3（慢、可带情绪），平时聊天用 Kokoro（快）；
语音消息显示为语音条 + 「转文字」；Owner 也要能发语音（服务器部署 SenseVoice 识别）；每个陪伴可选声音（两个引擎都可选，男女都能配）；
可调参数进后台设置。TTS 与线上 V2 在同一台服务器。

配套：`2026-10-30-companion-humanlike-design.md`（原则、回复流水线、主动引擎）、`2026-10-30-companion-copy.md`（文案）。
服务器实际地址、容器名、网络名、实测数据在 Owner 私有的 TTS 部署说明里，**不入库**（仓库公开）；仓库只出现环境变量名和占位符。

## 0. 借鉴（只借思路）

| 来源 | 做法 | 我们怎么用 |
|---|---|---|
| MaiBot TTS 适配器 | 文字回复按概率转语音，引擎可换 | 改成「模型标记 + 代码限频」，不用纯随机 |
| VocuTTS（AstrBot 插件） | 合成前过滤括号内动作，按情绪映射语气 | 合成前文本清洗；情绪→CosyVoice 指令 / Kokoro 语速 |
| yangyu-bot | 只在晚安、「说句话听听」这类时刻发语音 | 主动问候用语音；用户点名要听时必发 |
| KouriChat | 语音与文字二选一发送，失败回落文字 | 生成失败或超时一律回落为文字气泡 |
| MaiBot `enable_asr` | 用户语音先识别成文字再进对话 | SenseVoice 识别后按文字进入回复流水线 |

## 1. 服务现状（摘自私有说明，做设计约束）

| | Kokoro 中文 v1.1 | CosyVoice3 Q8 | SenseVoice（待部署） |
|---|---|---|---|
| 用途 | 聊天语音、试听 | 主动问候等预生成语音 | 用户语音转文字 |
| 速度 | 短句约 2 秒（RTF≈0.6） | 短句约 47–54 秒（RTF≈15） | 预计 1–2 秒/10 秒音频（待实测） |
| 接口 | `POST {base}/audio/speech`，`GET {base}/voices` | `POST {base}/audio/speech`，`GET /healthz` 的 `voices` | 计划 `POST {base}/audio/transcriptions` |
| 参数 | `model: kokoro-zh-v1.1`、`voice`（100 个中文音色）、`speed` 0.5–2.0、`response_format` wav/pcm；**不得**带 `instructions` | `model: cosyvoice3-q8`、`voice`、`instructions`（情绪）、`seed`、`stream:false` | 语言、是否返回情绪标签 |
| 并发 | 单并发，忙时 429 | 单并发 | 单并发 |
| 输出 | 24 kHz 单声道 16-bit | 同左 | — |

硬约束：
- 只对宿主机回环与 Docker 网络开放，无鉴权。**浏览器永远不直连**，只经 Go 后端代理。不得把端口发布到公网。
- 4 vCPU 共享（向量、重排也在用）。应用端串行：每个引擎同时最多 1 个任务，整机同时最多 2 个语音任务；聊天语音优先于后台 CosyVoice。
- 不改容器推理参数（线程数、步数、量化）——要改先问 Owner。容器重启策略可改为 `unless-stopped`（运维项 VO-6）。
- 超时：Kokoro 60 s，CosyVoice 300 s，ASR 30 s（可在后台改）。区分 400 / 429 / 500 / 超时，不无界重试：429 排队重试最多 3 次，其余直接失败回落文字。

## 2. 总体结构

```
扩展（浏览器）                     companiond（Go）                          宿主机 Docker 网络
 回复流水线 ──<voice/> 标记──▶  POST voice-clips（入队）─▶ 语音队列（DB 任务表，按引擎串行）─▶ Kokoro / CosyVoice
 语音条 ◀── GET clip 状态/音频 ◀── MinIO 存音频（按账号隔离）
 按住说话 ──16k WAV──────────▶  POST asr（同步，≤60 s 音频）──────────────────────────────▶ SenseVoice
 主动引擎 预生成文本 ──────────▶  同队列（CosyVoice，后台优先级）
```

- 配置：`VC_TTS_KOKORO_URL`、`VC_TTS_COSYVOICE_URL`、`VC_ASR_URL`（含 `/v1`），写在部署 `runtime.env`；未配置则对应能力整体关闭、界面隐藏入口。
  部署 compose 通过服务器侧覆盖文件让 runtime 加入 TTS/ASR 所在 Docker 网络（网络名只写在服务器 `deploy.env`，不入库）。
- 存储：音频存 MinIO（已有），键按 `owner/relationship/clip`；随消息删除、关系删除、账号删除级联清理；纳入现有备份与保留策略。
- 日志与指标：只记引擎、时长、状态、耗时，不记文本、不记音频、不记稳定用户标识（AGENTS 红线）。

## 3. 数据与接口（V272 迁移；OpenAPI/catalog 同步，`specs/generated` 只用工具生成）

- `vc.voice_clip`：id、owner、relationship、message_ref（聊天消息或主动消息）、purpose（chat / proactive / preview）、engine、voice、
  params（speed、instructions、seed）、text、status（queued / running / ready / failed / expired）、error_kind、object_key、
  duration_ms、generation_ms、created_at、ready_at。RLS 按 owner。
- `vc.voice_settings`（每个 owner 一行）：引擎开关、超时、每日上限（chat 默认 60、proactive 默认 8）、频率档（少 / 标准 / 多）、
  CosyVoice 场景指令表（早安、晚安、关心、分享、默认）、Kokoro 心情→语速表、ASR 开关、最长录音秒数（默认 60）。
- 关系级声音（放进关系或人设设置，按现有存储选最小改法）：`kokoroVoice`、`cosyVoice`、`speed`、`voiceFrequency`（关 / 少 / 标准 / 多）、`proactiveVoice`（开 / 关）。
  默认：女 → `zf_001` + CosyVoice `default`；男 → `zm_010` + CosyVoice 若无男声则主动语音改用 Kokoro 男声；不设定 → 同女。
- 接口：
  - `GET /api/v1/voice/engines`：各引擎是否配置、健康、音色列表（Kokoro `/voices`、CosyVoice `/healthz`），后端缓存 10 分钟。
  - `GET|PUT /api/v1/voice/settings`：全局设置，带 revision。
  - `POST /api/v1/relationships/{id}/voice-clips`：`{messageRef, text, purpose}` → 202 `{clipId, status}`；引擎和音色由服务端按关系设置决定。
  - `GET /api/v1/voice-clips/{id}`：状态；`GET /api/v1/voice-clips/{id}/audio`：鉴权后流式返回 WAV（支持 Range）。
  - `POST /api/v1/voice/preview`：试听（固定文案，走 Kokoro 或 CosyVoice，结果缓存，不计入每日上限）。
  - `POST /api/v1/voice/asr`：上传 16 kHz 单声道 WAV（≤ 最长秒数），同步返回 `{text, emotion?}`；音频不落盘。

## 4. 聊天语音（Kokoro）

触发（三者满足其一，且语音能力开启、本关系 `voiceFrequency≠关`）：
1. **模型标记**：提示词告知「想用语音说时，在回复末尾加 `<voice/>`；适合撒娇、安慰、晚安、开心激动、短句；长解释不要用」。
   代码门控：每轮最多 1 条；频率档 少 / 标准 / 多 ≈ 每 10 / 6 / 3 条助手回复最多 1 条；每日上限；严肃求助场景（现有安全 / 风险判定）不发；文本清洗后 > 80 字不发。
2. **用户点名**：用户这条匹配「发(条)?语音 | 说句话(给我)?听 | 想听你(的)?声音 | 用语音」等 → 本轮必发（仍受每日上限）。提示词同时告知本轮要用语音。
3. **用户发了语音**：上一条用户消息来自语音输入 → 本轮回语音。
- 标记保留在存储的消息里，显示层过滤（设计 §8：模型要看得到自己用过）。消息 `extra.vc_voice = {clipId, status, durationMs}`。
- 合成前文本清洗：去表情包标签、emoji、颜文字、Markdown、括号与星号动作；`~` → `，`；连续标点收敛；保留原文用于「转文字」。
- 心情→语速（可配）：开心 / 得意 1.05，懒洋洋 / 有点累 / 困 0.92，其余 1.0。
- 失败回落：入队后 15 秒未就绪或失败 → 显示为普通文字气泡（不提示错误）；就绪后再到达的不替换已显示的文字。

## 5. 主动语音（CosyVoice，允许等待）

- 在主动引擎「预生成」之后入队（purpose=proactive，后台优先级）。默认场景：早安、晚安 100%，情绪关心 50%，分享日常 30%，冷场 / 延续话题 0%（均可配）。
- 预生成需提前量：计划投递时间 − 现在 ≥ 5 分钟才排 CosyVoice；到投递时刻仍未就绪 → 若关系声音是 Kokoro 可在 10 秒内补生成，否则按文字投递。
- 场景指令（默认，可在后台改；文本必须以 `You are a helpful assistant.` 开头，与实测一致）：
  - 早安：`You are a helpful assistant. 请用刚睡醒、有点慵懒又温柔的语气说。`
  - 晚安：`You are a helpful assistant. 请轻声、温柔、放慢一点地说。`
  - 关心：`You are a helpful assistant. 请温柔关切地说。`
  - 分享：`You are a helpful assistant. 请开心、轻快地说。`
  - 默认：`You are a helpful assistant.`
- 关系声音选了 Kokoro 时主动语音也走 Kokoro（不带情绪，按心情调语速）。
- 投递：站内收件箱显示语音条；邮件 / 飞书仍发文字并注明「发来一条语音」，附站内链接（不附音频文件）。
- 失效与主动引擎一致：用户在等待期间说话则作废，语音任务一并取消。

## 6. 语音输入（SenseVoice）

- 服务器部署：sherpa-onnx + SenseVoice small（与 Kokoro 同一运行时），容器只对回环与 Docker 网络开放，单并发，内存上限 2 GiB；
  接口兼容 `POST /v1/audio/transcriptions`（multipart，字段 `file`，返回 `{text, emotion, language}`）。
  构建文件放 `ops/voice/asr/`（通用，不含主机信息）；部署用 ssh-skill，记录写服务器侧运行手册。
- 前端：输入框为空时发送按钮位置显示麦克风；按住说话、上滑取消、松开发送（桌面为点击开始 / 再点结束）；最长 60 秒；录音中显示时长与音量。
  浏览器用 MediaRecorder 录音，AudioContext 解码并重采样为 16 kHz 单声道 WAV 再上传（服务器不需要 ffmpeg）。需 HTTPS（线上已是）。
- 识别结果作为用户消息文本发送，消息 `extra.vc_voice_input = {durationMs}`；用户气泡显示为语音条 + 转文字（默认展开文字，因为没有存原音频）。
  原始音频不保存（隐私），只保存文字。SenseVoice 情绪标签（开心 / 难过 / 生气）作为本轮情绪线索喂给现有情绪状态更新。
- 识别失败：提示「没听清，再说一次？」（一句，不弹窗）。

## 7. 界面

- **语音条**（助手与用户）：宽度随时长（最短 72 px，最长到气泡最大宽的 70%），播放 / 暂停图标 + 时长；播放中波形动画（减少动效时静态）；
  同时只播放一条；未播放过的助手语音有小红点；下方「转文字」点击展开 / 收起原文。生成中显示「正在录音…」替代「正在输入」。
- **设置 › 语音**（全局）：引擎开关与健康状态、超时、每日上限、频率档默认值、CosyVoice 场景指令表、心情语速表、ASR 开关与最长录音。
- **角色详情 › 声音**：Kokoro 音色列表（按性别分组，可试听）、CosyVoice 音色（列表来自服务端）、语速、语音频率、主动问候语音开关。
- 遵循 DESIGN.md（Apple 应用语法、浅深色、390 首屏可用），不加说明性次级文字。

## 8. 拆分（可并行，单写入 owner）

| ID | 内容 | 主要文件 | 依赖 |
|---|---|---|---|
| VO-1 | 契约先行：OpenAPI + catalog + V272 迁移 + RLS 测试 | `specs/`、`backend/internal/migrate/sql/` | — |
| VO-2 | Go 语音模块：引擎客户端、队列 worker、MinIO 存取、设置读写、接口、fixture 引擎 | `backend/internal/voice/`（新）、router | VO-1 |
| VO-3 | 前端语音条 + 转文字 + 播放器 + 「正在录音」 | extension：新 `voice.js`/`voice.css`，`chat-view.*` 接入 | VO-1（契约） |
| VO-4 | 聊天语音触发：提示词标记、门控、点名识别、文本清洗、回落 | `reply-pipeline.js`、`companion-prompt.js`、`voice.js` | VO-2、VO-3 |
| VO-5 | 主动语音：预生成后入队、场景指令、提前量与回落、收件箱语音条、通知文案 | `backend/internal/proactive/`、`inbox-page.js` | VO-2 |
| VO-6 | 运维：compose 覆盖加入 TTS 网络、runtime.env 变量、TTS 容器 `unless-stopped`、部署自检加语音健康、本地镜像用 fixture 引擎 | `ops/deploy/v2/`、`scripts/local/` | VO-2 |
| VO-7 | ASR：服务器部署 SenseVoice、`/voice/asr` 后端、按住说话前端、情绪线索 | `ops/voice/asr/`、backend、extension | VO-1 |
| VO-8 | 设置页：设置 › 语音、角色详情 › 声音（试听） | extension 设置页 | VO-2 |

验收（每项各自）：Go 单测 + `node --test` + 新增受管场景 `voice-chat`、`voice-proactive`、`voice-input`（受管环境用 fixture 引擎返回固定 WAV，不调真实服务）；
真实引擎联调只在部署后用 Owner 账号以外的合成账号在线上做一次（VO-6 完成后），记录生成耗时。截图按 AGENTS.md「接手开发」规则存放。

## 9. 不做 / 以后

- 实时语音通话、流式 TTS（CosyVoice 流式在本机长文本超时，未验证）。
- 声音克隆新音色：从许可明确的开源语音样本挑 2–3 个（至少 1 男 1 女）在服务器提取（backlog VO-9）；界面音色列表自动出现新音色。
- 语音消息内情绪逐句切换。
