# 备份与恢复（§22.13 / R47）

演练入口：`bash infra/db/backup/run-backup-drill.sh`（匿名容器，无宿主端口/
卷挂载；产物走 stdout/docker cp；日志在 `$VC_DB_LOG_DIR`）。

## 策略（草案，Owner 复核）

| 项 | 草案 | 说明 |
|---|---|---|
| 全量逻辑备份 | 每日 `pg_dump -Fc` | 恢复粒度最细、可跨版本；产物加密存放于部署侧（密钥治理见 09-静态加密） |
| 物理基线 + WAL | `pg_basebackup` + 连续 WAL 归档 | PITR 能力：可恢复到任意时间点；`archive_command` 落部署侧 WAL 归档存储 |
| RPO | ≤ 5 分钟（WAL 段切换频率） | 草案值；`archive_timeout` 按需调低 |
| RTO | ≤ 1 小时 | 草案值；恢复 = 基线 + WAL 回放 + 本演练的验证套件 |
| 保留周期 | 与 `vc.data_retention_policy` 对齐 | §16.7 把「备份」列为独立保留类别；备份按保留周期自然过期（§16.6 删除流程末环） |

## 演练证明了什么（不是「数据库能启动」）

Phase A（逻辑）：

1. `pg_dump -Fc` → **drop database** → `pg_restore`；
2. 业务数据断言：消息正文、记忆状态（ACCEPTED）、导出残留行逐项核对；
   会话摘要在备份中为 enc2 密文（S0-32），恢复后仍由应用层解密，不会以明文复活；
3. **删除墓碑（两条路径）**：备份前已注销账号随备份恢复后仍不存在；另一个账号在
   `pg_dump` 之后删除，digest-only manifest 保存在备份/PITR 边界之外。恢复旧 dump 后
   先 dry-run reconcile（命中 1、零写），再 apply，确认复活账号与其业务数据重新删除、
   COMPLETED tombstone 落回恢复库；
4. **RLS 在恢复后的集群上成立**：重跑 01 跨用户读拒绝 / 02 跨关系引用拒绝 /
   70 伪造 owner 绑定拒绝三个真实攻击面测试。

Phase B（物理 PITR）：

1. `pg_basebackup` 基线 → 备份后写入 marker 行 → 强制 WAL 切换归档；
2. 全新容器以基线恢复 + `recovery.signal` 回放归档 WAL；
3. 断言 marker 行**只在回放后存在**——证明 WAL 真的回放了，而不是只起了
   一个旧基线。

## 生产落地清单（部署时，Owner）

- `[WAL 归档存储位置与加密方式]`
- `[每日 pg_dump 的宿主与产物保管]`
- `[RPO/RTO 复核结论]`
- `[account deletion digest manifest 的独立加密存储、访问角色与恢复顺序]`
- 定期（建议每月）跑一次本演练脚本
