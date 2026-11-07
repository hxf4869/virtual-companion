# SX-8 本机可信迁移演练

入口为 `companiond chat-migration`，只处理合成数据和隔离目标；真实账号切换仍需 Owner 另行授权。公开 JSONL 上传不进入此流程，manifest 的 Owner 字段不授权访问。数据库通过 `VC_WORKER_DB_DSN` 和现有 `VC_OWNER_BINDING_SECRET` 建立 Owner 绑定，迁移权限仅授予 worker。

```sh
companiond chat-migration forward --synthetic-isolated \
  --owner 1 --run 10000000-0000-4000-8000-000000000001 --expected-epoch 1 \
  --st-root /synthetic/st --artifact-root /synthetic/migration \
  --snapshot-tool integrations/sillytavern/scripts/chat-migration-snapshot.mjs \
  --account-handle synthetic
```

默认停在 VERIFIED/FROZEN。使用同一 run、原 expected epoch 和输入重跑可恢复 checkpoint；输入变化不会覆盖旧 checkpoint。显式加 `--activate` 才切换本次已验证的合成账号。正向依次执行 PG Freeze CAS、ST 私有 freeze/drain、本机文件快照、完整 codec/hash 校验、加密分块暂存、Stage、raw/source/alias/权利全量 Verify。未知来源会阻断，不从文件推测旧 generation 或遗忘状态。

反向使用新 run，`reverse --expected-epoch` 指向当前 GO epoch，首次 `--st-root` 必须尚不存在。续跑仅接受同 Owner/run/冻结 epoch、archive 和关闭 marker 均匹配的本次隔离根；每次仍重新导出 Go 当前状态并在新的空临时根恢复，核验通过后才替换该旧隔离结果。另传 `--character-directories '{"card":"restored-avatar"}'`，明确逻辑角色到 ST 物理目录的映射。CLI 完整导出 JSONL、所有身份与版本、alias、墓碑和权利清单，并通过受信 stdin 绑定本次 manifest。PG 再核对当前冻结状态及权利，完成后保留关闭的目标根。显式 activate CAS 到 ST 后才移除新根的同 run marker，旧运行根保持冻结。

若 CAS 已成功而 offline finalize 被中断，运行 `finalize`，传同 owner、run、新根及 **冻结后的 epoch**。该命令先读取 PG 当前权威，要求 ST epoch 恰好是冻结 epoch + 1，再核对新根 archive 与 marker 后完成关闭门移除。重启只能使用该已完成核验的新根。

`--latest-rights-manifest` 接受同 Owner 的共享 manifest，只合并其删除/抑制记录。当前 PG、外部最新记录与新空目标根按单调并集合并；无法核验的来源不视为删除。Go 记忆、inbox 与权利域持续保留在同一 PG 中，恢复前置由 Store 核验；此工具不恢复或声明已备份 MemoryCore、语音和其他数据域。

配置只来自显式参数与环境。沿用 `VC_CRYPTO_REST_KEY` 当前/前一密钥配置；正向还使用 `VC_ST_HOST_BASE_URL`、`VC_ST_PLUGIN_SERVICE_TOKEN` 和 `VC_EXPORT_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`。Token 仅通过 Node 子进程环境传递，stdin 传上下文；子进程输出被丢弃。错误与统计不含路径、Owner、source ID、正文或密钥。

`--artifact-root` 是专用私有目录（0700），只保留一份 `current` 已核验快照；新快照核验完成后才替换旧快照。本次临时目录与输入暂存对象在成功、失败和正常中断时定向回收，异常对象清理失败保留既有 durable intent 供 worker GC。未完成核验的反向临时根删除；已验证的关闭目标根是保留的恢复结果。不要手工把旧 ST 根当回滚源。

运营保留仍为最新一份已自校验加密备份与本次迁移快照；本工具不创建、替换或删除备份。旧 ST 根保留 7 天，到期清理必须由 Owner 确认。整栈加密备份/恢复演练属于 SX-13，真实切换前置不因本工具通过合成测试而免除。
