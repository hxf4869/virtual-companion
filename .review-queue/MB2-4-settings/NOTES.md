# MB2-4-settings 集成验收

候选在 `/Users/hxf/projects/vc-mb2-4-settings`，基线为 `4c6727f1`。共享表单保持 dirty、提交、409 和身份切换逻辑，桌面适配层注入导航、离开确认和现有偏好 store。路由与导入白名单机械合并到新基线。角色页回归保留关系语音路由的精确路径、类别与关系 ID，并核对新注入的四项回调和偏好对象。

| 验证 | 结果 | 耗时 | 记录 |
| --- | --- | ---: | --- |
| `git diff --check` | PASS | | |
| `npm --prefix integrations/sillytavern run check:desktop` | PASS | 47.31 秒 | [类型检查](final-check-desktop.log) |
| `npm --prefix integrations/sillytavern test` | PASS，1189/1189 | 93.85 秒 | [候选构建与 Node 测试](final-node.log) |
| `npm --prefix integrations/sillytavern run test:desktop -- --maxWorkers=2` | PASS，42 文件、181/181 | 18.37 秒 | [Vitest 复测](final-vitest-retry.log) |
| `node integrations/sillytavern/scripts/accept-managed.mjs --filter nf-settings,dr2-settings` | PASS，含依赖场景 `catalog-admin` | 86.81 秒 | [受管日志](final-managed.log)、[结构化结果](final-managed-results.json) |

首次默认并发 Vitest 暴露角色页替身仍按旧 props 形状断言，另外七项达到 5 秒超时。补齐角色页精确断言、限制 worker 并保留原超时后，完整套件通过。角色页改动仅为 Vitest 测试，生产候选 bundle 和 Node 套件的输入一致。 [初次 Vitest 日志](final-vitest.log)

- `nf-settings`（22.259 秒）在真实受管 Go/ST 栈里验证聊天运行时延迟期间仍能保存设置、离开时继续编辑或放弃、语音保存中阻止离开并通过 GET 读回、偏好持久化、模型绑定热切换后向夹具发送、禁用及恢复模型时的输入/历史行为、预算与身份失效时保留草稿。
- `dr2-settings`（14.020 秒）验证同意门禁、八类产品设置、九类酒馆设置、语音 409 后保留草稿与加载最新、错误密码拒绝重验且无导出写入、正确重验后取得 export ID、外观偏好及导航连续性。
- `catalog-admin`（0.421 秒）验证 provider 保存与读回、Key 三态、409、独立用途绑定及合成 provider 探测。
- 桌面单测覆盖模型保存期间仍出现离开确认、F19 经真实偏好 store 更新主题和本地状态、退出成功顺序与失败不清会话、关系语音请求端点、通知入口，以及角色页到声音设置的参数传递。

`final-nf-settings-{appearance,model,voice}-{390,1440}-{light,dark}.png` 共 12 张，已校验 PNG 尺寸为 390×844 或 1440×900。场景核对窄屏控件、模型协议名和外观开关对齐。截图留给主代理做统一视觉对照。本轮运行设置受管场景，`dr-appearance` 和 `dr-shell` 为原实施报告另列的场景。

运行于 Node 22.23.1、本机 OrbStack、合成账号和 provider 夹具。已确认独占端口释放、三个测试容器不存在、已记录挂载的测试卷已移除。已回收本次运行目录和原生 bootstrap 临时文件，保留工作树原有缓存链接。


## MB2-4 最终组合视觉复核

完整 dr2-layout 同顺序合成数据捕获，实际查看旧基线与最终组合：14-settings-model，各 390x844 浅色及 1440x900 深色；已复制配对图。布局、对齐与换行保持，无发现抽取回归。时刻、fixture 端口和动态极光采样可能不同，不宣称逐像素相同；模型档位的 MB2-2a 已批准功能差异不视为回归。完整结果见 ../MB2-4-final/。
