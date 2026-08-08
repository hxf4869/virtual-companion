# TASK-0097 R1 独立评审报告

- 候选：`fa93a8a7a3b2133faf8dac5901508eae691ded9f`
- Tree：`f7c24868b2ac64eae08748238731629f6a864fbd`
- Reviewer：`task0097_r1`，只读评审，未修改仓库
- Verdict：**APPROVE**

## 范围与完整性（COMPLETE_MATRIX）

- `git diff 9bf02d2..fa93a8a --name-status` 仅 5 个文件，全部在 writeAllowlist 内：
  `.harness/project-state.yaml`、任务卡、context lock、OpenAI 与 Anthropic 两个 boundary
  contract test；未触碰任何 forbiddenPaths；`git diff --check` exit 0。
- 两个测试的 diff 仅把单条过期 `assertFalse(runtimePom.contains(...))` 替换为新断言块，
  无其他改动、未删测试、无 skip。

## 测试语义（逐条对照真实文件）

- runtime POM 声明 approved adapter 依赖：OpenAI 测试断言 openai+anthropic 坐标、
  Anthropic 测试断言自身坐标；`service/apps/runtime/pom.xml` 证实两依赖存在。
- application.yaml 无默认 endpoint/secret 且默认关闭：断言
  `${VC_MODEL_PROVIDERS_ENABLED:false}` 且不含 `api.openai.com`/`api.anthropic.com`/
  `sk-`；真实 yaml 第 64 行与 grep 证实相符。
- provisioner 仅 approved 才 provision：断言 `if (!deployment.enabled())` 且无
  `http(s)://`/`sk-` 字面量；`ApprovedModelProviderProvisioner.java:50` 与 grep 证实。
- adapter 源码既有断言（无 endpoint/环境读取/日志）与源码相符。

## 复跑（验收 2/3）

```
docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
MAVEN_EXIT: 0 — BUILD SUCCESS（复跑两次一致）
OpenAiChatCompletionsBoundaryContractTest: 7/7 PASS
AnthropicMessagesBoundaryContractTest: 7/7 PASS
```

## 发现

- P0/P1/P2：无。
- P3（非阻塞）：OpenAI 测试断言两个坐标而 Anthropic 只断言自身（不对称，均满足验收）；
  `findRepositoryRoot()` 依赖工作目录为仓库根（既有模式，非本次引入）。
- 远端 backend job exact-SHA 复核由终态流程执行（NOT_RUN by reviewer）。

候选可进入 closure 流程。
