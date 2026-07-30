# TASK-0038 45 分钟 gate 独立预审

```yaml
taskId: TASK-0038
reviewerId: task-0038-coordination-gate-pre-review
kind: budget-gate-pre-review
verdict: FAIL
reviewedCommit: 9c5fa1962d0add820793fb2af46bfa80f5dd8b6b
reviewedTree: 1ba1af457503a50457f367cac542922e1e682f2d
```

## 结论

FAIL。`reviewedCommit` 是 TASK-0038 最后一个已提交的 IN_PROGRESS 控制点；45 分钟 gate 到达时不存在
实现候选 Commit/Tree。预审只读检查了当时的未提交尝试，发现仍有阻断 findings，因此该工作树不具备
冻结资格，也没有被表示成已评审实现。它已保存到本地 stash `16bc536df6f7ebf9e17e0e08a187d8a1b81ebc09`，
未推送到 `origin/main`。

## 阻断 findings

- P1：`longline` 必须以 ACCEPTED、push、Handoff、remote 与 exact-SHA CI 为正常放行条件；BLOCKED
  只阻断依赖分支，DAG 仍有独立可晋级卡时不得暂停。
- P1：AGENTS 薄入口必须保留 idle DRAFT、planning-only resolution 与 terminal closure 治理例外，
  且 protected path 只要求规则声明的审批或独立 Reviewer。
- P1：Skill Creator frontmatter 与 Windows 编码、旧 AGENTS 完整策略断言、happy-path lifecycle
  命名尚需统一到机器策略与 Skill 投影。
- P1：checkpoint 的 project-state 必须按派生 nextAction 决定是否参与原子边，不能强制每次改变；
  Task ID 必须精确唯一匹配，并为无可晋级卡或只剩 Owner gate 定义确定性状态。
- P1：Backlog、project-state 与 card 的父子 tree entry 都必须保持 `100644 blob`，mode corrupt/restore
  必须失败关闭；错误后恢复不能洗白历史。
- P1：real-Git baseline 必须清空 resolutions，并只使用 fixture 自己合成的 PLANNED bytes 做
  corrupt/restore；不得重新读取当前 ROOT card。
- P1：DRAFT checkpoint、Base-Handoff、idle terminal 与 terminal Diff Scope 四个消费者都需要轻量
  集成证明；测试类不得因继承 TestCase 重复执行父类矩阵。

## Gate 与边界

- 目标候选 deadline：45 分钟；实际触发：约 45.5 分钟。
- Reviewer R1、candidate canonical、exact-SHA CI：均未启动。
- 预审 verdict 为 FAIL，不得转写为 PASS；TASK-0038 只能以执行态 REJECTED 收束。
