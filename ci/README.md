# CI provider adapters

活动 GitHub Actions 真源是 `.github/workflows/ci.yml`。本目录不保存可复制的第二套检查步骤。

未来接入 GitLab、Jenkins 或其他 CI 时，provider 配置只负责准备仓库、Python 和 `requirements-harness.txt`，随后调用：

```text
python scripts/harness/precheck.py
```

Harness 命令和顺序只能来自 `.harness/commands.yaml`；不得在 provider 配置中重新维护 Catalog、Beta、付费能力或任务门禁列表。
