# TASK-0106 R1 独立复核报告

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit: `55fb6d54d802c21aa481f618814cb232b6a2162c`（候选实现；实现树与最终候选 6505060 逐字节一致，见 Evidence chainRebuildNote）
- Base: `950162c94a008bf741c48cf55e0d57374d1c8b62`
- Verdict: **FAIL → fix batch（happy-dom 20.11.2）→ R2 closure PASS**（R1 发现 1×P1 阻塞 + 1×P2 说明）

## 逐项核对（R1 原判）

1. **Diff Scope — PASS**：diff 文件全部落在 writeAllowlist；forbiddenPaths 零命中；git diff --check 干净。
2. **P2-18 计数（候选上实测）**：`pnpm audit` = **1 critical / 4 high / 12 moderate / 2 low**；基线 11h/18m/7l → 显著下降，但**本卡新增 happy-dom@17.4.4 引入 1 critical（GHSA-37j7-fg3j-429f，VM Context Escape→RCE，修复 ≥20.0.0）+ 2 high（GHSA-w4gp-fjgq-3q4g ≥20.8.9、GHSA-6q6h-j7hj-3r64 ≥20.8.8）**，不在例外台账，台账头部计数声明与事实不符。
3. **P2-18 override 真实性 — PASS**：15 项 override 全部在 pnpm-lock.yaml 落地（adm-zip@0.6.0、body-parser@1.20.6、brace-expansion@2.1.4、cookie@0.7.0、esbuild@0.25.0、nanoid@3.3.17、path-to-regexp@0.1.13、postcss@8.5.24、qs@6.15.2、send@0.19.0、@intlify/core-base@9.14.5、@intlify/message-resolver@9.1.11、@babel/core@7.29.7）；漏洞旧版全部移出树；无意外漂移。
4. **例外台账 — 部分 PASS**：vite 5.2.8（15 advisories）与 vue-template-compiler 2.7.16 条目字段完整（package/version/advisories+severity/owner/reason/attackSurface/expiryDate=2026-11-09）；happy-dom 未覆盖（P1）。
5. **P2-19 ci.yml — PASS**：frontend job install 后新增 "Test H5"（test:run）与 "Type-check H5"；build 保留；触发条件/permissions/其他 job/actions 版本零改动。
6. **P2-19 组件测试 — PASS**：3 页面 spec 真实挂载 .vue（@vue/test-utils + happy-dom + @vitejs/plugin-vue 入 devDeps/vitest 配置）；断言覆盖 memory（role=alert/空证据容器/保存失败保持编辑态）、login（aria-label/role=alert+焦点/submitting aria-busy）、chat（role=status+aria-live/失败文案/aria-busy）；全部 stub 无真实网络。
7. **既有用例 — PASS**：stores/api 既有 spec 零 diff；138/138（128+10 新增），0 skipped。
8. **相邻风险 — PASS**：allowBuilds 保留；package.json 无残留无效 overrides；esbuild 0.25.0 在 vite 5.2.8 链下 build/test 全绿；frozen-lockfile 一致；无删测/skip/吞退出码。

## Findings

- **P1（阻塞，采纳进 fix batch 078774b）**：happy-dom@17.4.4 引入 1 critical + 2 high advisory 且未入例外台账，台账计数声明失实 → 升级 happy-dom 至 20.11.2（≥修复线 20.8.9）并复跑 audit 修正计数声明。
- **P2（说明）**：@vue/test-utils 引入 js-beautify/editorconfig/glob 链与 vue-component-type-helpers 为良性新增（无 advisory），无需处理。
