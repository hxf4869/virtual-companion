# MB2-4 抽取前桌面基线

基线：mobile-react-rebuild@6c2b098f，生产代码与f502c4b9一致。

现有受管入口 `node integrations/sillytavern/scripts/accept-managed.mjs --filter dr2-layout --capture`：catalog-admin、dr2-layout 2/2 PASS；后者含9宽度、断点往返、六页几何与截图，场景用时358.552s。截图169张，固定合成夹具、现有settlePage与主题校验，未经额外样式覆盖。

供MB2-4各批按相同状态比较；本轮MB2-2a明确变更的模型档位文案/选项应以其通过后的对应状态作设置页基准，不能将批准功能差异归为抽取回归。

首次启动发现本机缺锁定依赖及生成bundle，已用现有npm ci、prepare-desktop-source与build-desktop恢复，最终上述场景通过。测试进程与两个受管容器已按归属清理；原始日志同目录。仅保留这一份本轮基线，不覆盖它来消除候选差异。
