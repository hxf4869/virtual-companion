# MB2-4-tavern 独立集成验收

**RESULT=PASS**。候选以 4c6727f1 为基线，包含 10 个文件。业务 hook、查询层、弹层与表单视图、酒馆测试，以及桌面路由与导入白名单接线均在候选范围内。路由和白名单冲突按基线已有条目与酒馆候选条目机械合并。final-tracked.patch 保存前移前 tracked 差异，final-rebased.patch 包含相对新基线的 10 个文件，其中两个为新增源文件。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm --prefix integrations/sillytavern run test:desktop | 首次 173 通过、8 个用例达到 5 秒超时，耗时 45.37 秒 | final-vitest.log |
| npm --prefix integrations/sillytavern run test:desktop -- --maxWorkers=2 | 42 文件、181 用例通过，耗时 14.75 秒。保留用例超时和断言 | final-vitest-workers2.log |
| npm --prefix integrations/sillytavern test | 构建通过，1189 用例通过，总耗时 102.58 秒 | final-node.log |
| accept-managed.mjs --filter nf-tavern,nf-cards | catalog-admin 0.451 秒、nf-cards 19.221 秒通过。nf-tavern 首次在 Monaco 内容回填处失败，耗时 9.188 秒。整轮 84 秒 | final-managed.log、final-results.json |
| nf-tavern 同候选独立运行，加入模型和 DOM 观测 | 完整断言通过。nf-tavern 26.286 秒，整轮 77 秒 | final-monaco-probe.log、final-monaco-probe-results.json |
| nf-tavern 同候选定向负载观察 | 编辑器键入段使用 Chromium CPU 降速 6 倍。6 次真实键入均完整，原场景断言通过。nf-tavern 29.263 秒，整轮 79 秒 | final-monaco-load.log |
| git diff --check | 通过 | 独占 worktree 当前 diff |

nf-cards 覆盖锁定复杂卡、变量链、重放和隔离。nf-tavern 覆盖聊天 runtime 延迟时可配置、条件保存与冲突草稿、表单校验、世界书代码编辑及设置、角色卡、Helper 宏、嵌套 EJS、续写和聊天世界书。新组件用例另覆盖桌面路由 search 与跳转参数、迟到加载、角色删除二级确认、预设另存及世界书引用清理。

首次失败截图显示点击「完成」前 Monaco 可见行已丢字符。常态观察与 6 倍降速观察均保持同一 Monaco DOM 节点与唯一编辑器，每轮 24 次 beforeinput 对应 24 次模型变更，未见 executeEdits 回写，正常关闭时编辑器释放。候选 CodeField.tsx 的前 768 行，包括 Monaco 和 WorldCodeEditorDialog，与 4c6727f1 逐字节一致。首轮丢字的精确触发条件仍未确认，未发现此次抽取引入该现象的证据。

截图 final-nf-cards-* 来自通过的卡片场景。final-probe-nf-tavern-* 来自通过的酒馆独立场景，含回复、世界书、代码编辑器和扩展的 1440/390 浅色与深色。final-nf-tavern-* 保留首轮失败现场。共同视觉对照由主代理在整合候选上完成。

受管环境使用 OrbStack、隔离运行目录和 ST/fixture/Go/MemoryCore 端口 28932/28933/28236/28934，Chromium 由本机 Playwright 缓存提供。全量 SQL 迁移通过。首次 npm test 使用了备份用例默认的 vc-q2-managed-pg，测试脚本按归属清理，事后核对该容器不存在。三轮受管测试容器、已记录挂载的测试卷、独占运行目录及临时 bootstrap marker 均已回收。


## MB2-4 最终组合视觉复核

完整 dr2-layout 同顺序合成数据捕获，实际查看旧基线与最终组合：17-tavern-reply、18-tavern-world，各 390x844 浅色及 1440x900 深色；已复制配对图。布局、对齐与换行保持，无发现抽取回归。时刻、fixture 端口和动态极光采样可能不同，不宣称逐像素相同；模型档位的 MB2-2a 已批准功能差异不视为回归。完整结果见 ../MB2-4-final/。

最终组合 nf-tavern 的 editor 390 浅/1440 深也已实看，与本目录前次同名状态对比布局保持；输入文本随测试执行结果不同。本次完整原断言通过。
