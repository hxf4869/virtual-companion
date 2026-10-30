# SenseVoice 输入

固定 `sherpa-onnx 2.0.1`、SenseVoiceSmall INT8（2024-07-17 转换版本），CPU 单线程、单并发，容器内存上限 2 GiB。
首次部署参数随 VO-7 确定；后续更改模型、量化或线程须先征得 Owner 同意。

API 为 `POST /v1/audio/transcriptions`，仅接收一个 `file` multipart：16 kHz 单声道 16-bit PCM WAV，最长 60 秒。
原音频只在内存处理，不写文件、不记录请求正文；返回文字、可选情绪及语言。容器不发布端口，仅接入服务器私有语音网络。

服务器私有 `deploy.env` 填 `VC_ASR_IMAGE`、`VC_VOICE_ASR_CONTAINER`、`VC_VOICE_NETWORK`；
通过 ssh-skill 执行本目录 Compose 构建 / 启动，`runtime.env` 配置 `VC_ASR_URL`（含 `/v1`）。
实际名称、地址与服务器运行记录只保留在服务器侧。构建临时模型包在同一构建步骤删除；运行无写入卷，日志 3×10 MB。
升级后只保留当前镜像及被容器引用的版本，定向回收本次旧镜像与构建缓存。

上游依据：[Python API](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/python-api-examples/offline-sense-voice-ctc-decode-files.py)、
[模型说明与下载](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)、
[sherpa-onnx 许可](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE)、
[SenseVoiceSmall 模型卡](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)、
[FunASR 模型许可](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)。
镜像保留转换模型随附 LICENSE；不把 SenseVoice 软件仓库许可等同于模型权重许可。
