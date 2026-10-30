# 开源音色来源（VO-9）

只使用原始录音和明确许可，未使用已有 TTS 模型输出作为样本。
`open-voices.json` 固定发布者版本；下面两个音色均采用发布者随仓库提供的 CC0 1.0 声明。

| 音色 ID | 性别 | 原始录音 | 来源与许可 |
|---|---|---|---|
| `open_female_kathleen` | 女 | `arctic_a0001_1592748574.wav`，3.296 秒，48 kHz 立体声；不改录音内容 | [Rhasspy / Kathleen 原发布页](https://github.com/rhasspy/dataset-voice-kathleen/tree/c51cb971036a127359b43c621f26ca5081eab13e)、[CC0 许可](https://github.com/rhasspy/dataset-voice-kathleen/blob/c51cb971036a127359b43c621f26ca5081eab13e/LICENSE) |
| `open_male_thorsten` | 男 | `sample01-gt.wav` + `sample02-gt.wav`，合计 3.970 秒，22.05 kHz 单声道；仅顺序拼接两段同一说话人的原始录音 | [Thorsten Müller 原发布页](https://github.com/thorstenMueller/Thorsten-Voice/tree/29d0c153c55d8ffaa0ebf8ed1ecc879bff9fdf27)、[CC0 许可](https://github.com/thorstenMueller/Thorsten-Voice/blob/29d0c153c55d8ffaa0ebf8ed1ecc879bff9fdf27/LICENSE) |

用途是个人陪伴项目的 CosyVoice prompt 特征，不表示原说话人为角色或项目背书。
Kathleen 是英语参考，Thorsten 是德语参考；跨语言中文实际效果在批次末以合成账号试听验证，不能用录音许可替代效果验收。

在服务器通过 ssh-skill 运行 `extract-open-voices.py`，参数指向该服务器已有的 `cosyvoice-cli`、
speech tokenizer 和 campplus；只运行 frontend-only，不重设现有模型、量化或推理参数。
每个音色只保留一个 GGUF 与一份许可原文；临时录音与中间文件在成功 / 失败后自动清除，已生成 prompt 不重复提取。
最终统一接网时，在服务器私有启动配置追加两个 `--voice-prompt <音色 ID>=<私有路径>`，保留其他参数原样后重启该引擎。
实际容器名、路径、网络与运行记录只保存在服务器私有配置 / 手册，仓库不记录这些值。

`GET /healthz` 的音色列表是客户端真源。新 ID 的 `open_female_` / `open_male_` 前缀只补充性别，
音色仍须由引擎实际返回才可选；不在客户端造列表。Go 缓存最长十分钟，统一部署重启后立即刷新。
[提取接口依据](https://github.com/Lourdle/cosyvoice.cpp/blob/main/docs/TOOLS.md#c-frontend-only-mode-generate-prompt_speech-and-exit)。
