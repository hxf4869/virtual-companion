# TASK-0108 独立复核 R1（只读）

- Reviewer: R1（independent review，C3）
- 候选提交: `4cf4746083f4f5f9d1458e80f295dd85d97ed11d`（tree `b085aecdcc3c4de6588ede4e2be3651d2dc69d69`，已核对一致；单父提交，parent `2e3aa85`）
- Base: `df85ece8eb86774ba536e8f349fb8f7a5e44515f`
- 复核范围: COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK
- 方法: 静态审阅 candidate 提交 `git diff 2e3aa85..4cf4746` 与候选文件全文；未重跑 Maven（按 policy reviewerRunsExpensiveFullTests=false），编译结论基于实施者定向测试证据与静态可证性

## 总体裁决: PASS

未发现阻塞性 P0/P1；1 项 P2（验收 2 字面偏差，fail-closed 更保守，建议 Handoff 登记）与 2 项 P3（DNS 解析边界、hostname 大小写）为非阻塞。实现与测试真实、范围合规，定向测试证据与 precheck 结果属实。

## 复核结论摘要（正面核验）

- **范围合规**：candidate 提交仅 9 文件（2 新增 + 7 修改），全部落在 writeAllowlist；forbiddenPaths（specs/**、**/db/migration/**、safety/memory、modelruntime contract|execution|guard|authorization|registry|routing、model-openai/model-anthropic 其他文件、model-protocol-contract-tests/** 等）零触碰。`git diff --check` 干净（DIFF_CHECK_CLEAN）。
- **P2-05 secret 路径穿越（实现正确）**：`ProviderSecretReader.java` 加固完整——
  - basename 限制（:73-83）：`/`、`\` 分隔符与 `.`/`..` dot segment 全部 `IllegalArgumentException`；
  - root containment（:85-93）：`secretRoot.toAbsolutePath().normalize()` 为根，`resolve().normalize().startsWith(root)` 拒绝 `..` 逃逸；
  - 符号链接拒绝（:50）：`Files.isSymbolicLink` 检查堵住 symlink 指向 root 外文件的绕过（containment 强化）；
  - regular file + 大小上限 64 KiB（:51, :58-62）与 POSIX group/other 可写拒绝（:95-108，非 POSIX 平台跳过）；
  - 失败语义保持 fail-closed：未知 secret/逃逸/超限/权限不安全 → `IllegalStateException`，绝不回退空白或猜测值。
  - 测试真实覆盖：穿越名 7 种（`../`、`sub/../`、绝对路径、子目录、`\`、`.`、`..`）、symlink 逃逸、超限文件、group 可写（POSIX 平台）；既有 5 个测试不回归。
- **P2-05 egress allowlist（实现正确）**：新增 `ProviderEgressPolicy`（modelruntime/port，C3 protected）——
  - 默认 allowlist = {api.openai.com, api.anthropic.com} + 127.0.0.1 loopback（http/https 任意端口，保既有 `http://127.0.0.1` mock-server 契约测试正例）；
  - loopback 外 https 强制（:70-74）、端口必须 443（:76-80）；
  - IPv4 字面类别阻断（:99-137）：10/8、172.16/12、192.168/16、127/8（除 127.0.0.1 显式路径）、169.254/16（含 169.254.169.254 metadata）、100.64/10（含 100.100.100.200）、0/8、224/4+ 组播/保留/广播；
  - IPv6 字面一律拒绝（:58-60，含 ::ffff:127.0.0.1 映射绕过）；hostname 精确匹配 allowlist（:84-86）；公网字面 IP 不在 allowlist → 拒绝；
  - 纯词法校验（不解析 DNS、不开连接）；错误消息不含凭据/配置细节；策略可注入（自定义 host 集），构造拒绝空集与含 loopback 的集合（fail-closed 配置）。
  - 测试覆盖 14 个方法：approved 正例、loopback 任意端口、明文拒绝、未获批 host、公网字面 IP、私网三网段、loopback 段外、link-local/metadata、CGNAT/metadata、any-local/组播/保留/广播、非 443 端口、IPv6（含 ::ffff: 映射）、缺失 host/scheme/null、自定义 allowlist、非法策略配置。
- **Config 接线（实现正确）**：两个 config 的 `requireEndpoint` 保留既有 scheme/host/path/userinfo/query/fragment 校验后追加 `ProviderEgressPolicy.defaults().requireAllowed(value)`；既有正例（`http://127.0.0.1`、`http://127.0.0.1:9`）与既有负例（ftp、错误 path、编码路径、userinfo、query、header 注入 token）全部保持。跨供应商 host（api.anthropic.com + OpenAI path）在 egress 层面合法不拒绝——正确（allowlist 覆盖两个获批供应商，path 语义由各 config 自身契约校验）。
- **Provisioner 接线**：无需改代码——config 构造即接线点；`ApprovedModelProviderProvisionerTest` 新增非法 endpoint（https://evil.example.com）与穿越 secret 引用（../openai-key）两例失败关闭，验证 provision 全链路。
- **验收逐项**：1（secret 加固 6 项断言）✓；2（egress 矩阵）✓；3（config 接线 + 既有契约测试不回归）✓；4（Provisioner 失败关闭）✓；5 的 precheck 5/5 与定向测试 BUILD SUCCESS 属实（见下方证据核验）；6（定向测试含 model-protocol-contract-tests 编译面，7 模块 reactor BUILD SUCCESS，modelruntime/apps/openai/anthropic/两个 contract-tests/model-protocol-contract-tests 全绿）✓。

## Findings

### P0（阻塞性安全/不变量破坏）

无。

### P1（验收违反，阻塞）

无。

### P2（非阻塞缺陷）

- **P2-01 — 验收 2 与实现存在字面偏差：`100.100.100.200`（阿里云 metadata）落在 100.64/10 CGNAT 阻断内，实现按"shared/CGNAT (incl. metadata)"合并处理**。卡验收 2 原文把"私网/link-local/metadata"分列，实现把 metadata 100.100.100.200 归入 CGNAT 段统一阻断——语义等价（都拒绝）、fail-closed 更完整（100.64/10 整段含阿里云 metadata），建议在 Handoff 登记偏差说明。非阻塞。

### P3（建议）

- **P3-01 — hostname 不区分大小写问题未处理**：`URI.getHost()` 保留原样大小写，allowlist 为小写精确匹配——`https://API.OpenAI.com/` 会被拒绝。fail-closed 方向正确（绝不误放行），但合法大小写变体被拒可能误伤；建议后续卡补充 `equalsIgnoreCase` 兼容（非阻塞，默认严格拒绝更安全）。
- **P3-02 — allowlist 内 hostname 的 DNS 重绑定边界**：策略只做 host 字符串与字面 IP 类别校验，不解析 DNS；获批 hostname 若被 DNS 重绑定指向私网 IP，本卡无法阻断（HttpClient 侧解析）。卡已明示"不引入 DNS 解析依赖"为设计边界，建议 Handoff 登记为已知边界，由后续 egress/DNS 层策略卡承接。
- **P3-03 — `requireAllowed(null)` 抛 NPE 而非 IAE**：与 `ProviderSecretReader.readSecret(null)` 语义一致（Objects.requireNonNull），测试已固定；可接受。

## 不变量核验

- INV-AUTH-001：PASS（授权快照流程未改；egress 校验只作用于 adapter 出站配置边界）。
- INV-HARNESS-002/003：PASS（单父原子提交链、writeAllowlist 合规、protected glob service/**/modelruntime/** 触碰路径 `port/ProviderEgressPolicy*` 已由卡声明 C3 + model-routing-change + 独立复核）。
- INV-HARNESS-005：PASS 条件满足（实施者定向测试与 precheck 均有真实执行证据；根级 verify 尚未在本树执行，closure 阶段执行并如实记录）。
- INV-HARNESS-007/009：无违反（canonical precheck 已跑 5/5 PASS；exact-tree 通道按 READY 冻结 profile 走本地回退，远端配额耗尽如实记录）。

## 复核结论

裁决 PASS（阻塞 P0/P1 为零）。1 项 P2（验收字面偏差，fail-closed 语义等价）与 3 项 P3 建议记入
Handoff。修复非必需；若实施者后续补 P3-01（大小写兼容）需新增测试，仍在本卡 writeAllowlist 内。
R2 无需重启（R1 PASS 无阻塞发现）。
