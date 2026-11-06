# MB2-4 剧情共享层候选验收

基线 `4c6727f1`。剧情候选抽取列表与开局、进入运行、舞台动作和投影、回档及结局保存逻辑。桌面路由适配器继续注入运行参数、模型设置导航、减弱动态与离开保护。同步基线时只机械合并了剧情路由和导入白名单，剧情源码与测试内容保留原候选。可用 `final-candidate.patch` 集成。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 生产 bundle、TypeScript、导入边界 | PASS，`npm test` 的 pretest 已成功完成 | `final-node.log` |
| 桌面 Vitest | PASS，42 文件、181 用例，20.675 秒 | `final-vitest-limited.log` |
| Node 离线与隔离真库备份 | PASS，1189 用例，29.865 秒 | `final-node-limited.log` |
| 受管 `catalog-admin` | PASS，0.346 秒 | `final-managed-results.json` |
| 受管 `dr2-pages` | PASS，22.618 秒 | `final-managed-results.json` |
| 受管 `nf-business` | PASS，12.513 秒 | `final-managed-results.json` |

受管命令 `node integrations/sillytavern/scripts/accept-managed.mjs --filter nf-business,dr2-pages` 使用本地 OrbStack、Chromium、ST、Go、MemoryCore 与合成模型夹具，含启动和清理总计 1 分 40 秒。场景确认模型配置契约、角色和实例、记忆和陪伴，以及五步剧情开局、七次行动、条件不足时不改变世界、投影写回、结局摘要进入待确认记忆、回档与刷新恢复。桌面测试覆盖失败后保留开局草稿与重试、过期请求卸载、投影和回档防重、未保存结局摘要的路由离开保护。

首轮默认并发下，桌面聊天历史定位与 Node 模型预留超时各有一个失败。两个文件分别复跑通过，全量降低并发后均通过。日志保留原失败与复跑结果，未调整断言或超时阈值。

受管脚本保存角色、记忆、日记、陪伴、剧情五页共 20 张当前候选截图。`final-nf-business-story-*.png` 是独立桌面宿主的剧情舞台，包含 1440×900 与 390×844、浅色与深色四种组合。脚本已断言页面无横向溢出且视口中心命中当前业务页。未采集本次候选的独立旧实现同条件截图，未做像素或完整 DOM 对照。390 截图覆盖桌面窄窗，手机实际页面留待后续条目。原生 bridge 本轮通过直接消费者核对及离线套件覆盖，未单独运行原生宿主浏览器场景。

受管运行目录、专用容器和已确认归属的备份测试挂载卷已清理，四个测试端口均无监听。


## MB2-4 最终组合视觉复核

完整 dr2-layout 同顺序合成数据捕获，实际查看旧基线与最终组合：13-story-stage，各 390x844 浅色及 1440x900 深色；已复制配对图。布局、对齐与换行保持，无发现抽取回归。时刻、fixture 端口和动态极光采样可能不同，不宣称逐像素相同；模型档位的 MB2-2a 已批准功能差异不视为回归。完整结果见 ../MB2-4-final/。
