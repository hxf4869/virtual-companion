package com.virtualcompanion.runtime.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.InMemoryAdapterLocator;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotStore;
import com.virtualcompanion.runtime.loopback.LoopbackModelProtocolAdapter;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.safety.ClassifierReport;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * S0-25 跨层闭环测试：「铸造快照 → 撤回同意 → 执行排队任务 → Provider HTTP
 * 调用为 0」。
 *
 * <p>生产装配下（{@code ApprovedModelProviderConfig} +
 * {@code AuthDataSourceConfig}），外发前的授权复核读取的是 DB 权威
 * {@code vc.authorization_snapshot}（经 {@link JdbcAuthorizationSnapshotStore}，
 * 在 worker 的 owner-bound prepare 事务里、RLS 按 owner 收敛），不再依赖任何
 * 进程内镜像。本测试用一张共享「假表」替代 JDBC 传输层（SQL 文本仍由真实
 * store 执行并断言指向 {@code vc.authorization_snapshot}；真实数据库行为——
 * RLS、V26 铸造、V46 撤回——由 infra/db 测试 67/68/101/126 与
 * run-rls-tests.sh 证明）：
 *
 * <ul>
 *   <li>铸造：以双 ACTIVE 行表示 V26 {@code create_authorization_snapshots}
 *       的提交结果；</li>
 *   <li>撤回：走真实的 {@link ConsentService#record} 撤回分支（V41 记录 +
 *       V46 {@code vc.withdraw_authorization_snapshots} 同事务翻转该 owner 全部
 *       ACTIVE 快照）；</li>
 *   <li>执行排队任务：完整 {@link LiveModelInvoker} guarded chain，计数适配器
 *       统计 {@code adapter.open}（即真实路径上的 Provider HTTP 外发次数）。</li>
 * </ul>
 *
 * <p>覆盖：撤回后执行排队任务外发 0 次；并发撤回（函数语义幂等 + store 语义
 * 单向不复活）；多实例共享权威（另一实例的撤回立即约束本实例外发）；权威读取
 * 失败 fail-closed；以及历史审计仍可读、陈旧进程内镜像无法救回已被权威拒绝的
 * 外发。
 */
class WithdrawnConsentOutboundBlockTest {

    private static final long OWNER = 1L;
    private static final OwnershipTuple OWNERSHIP =
            new OwnershipTuple("1", "9", "5", "10");
    private static final ProviderId PROVIDER = new ProviderId("alpha-loopback");
    private static final ProviderRegion REGION = new ProviderRegion("us");
    private static final ProviderContractRef CONTRACT =
            new ProviderContractRef("alpha-standard");
    private static final Set<DataCategory> CATEGORIES = Set.of(DataCategory.MESSAGE_TEXT);
    private static final String CONSENT_TYPE = "MODEL_TRAINING";
    private static final String CONSENT_VERSION = "2026-08-audit-v1";

    /** {@code vc.authorization_snapshot} 行的共享替身（owner 列 + 值对象列）。 */
    private static final class Row {
        final long ownerUserId;
        volatile AuthorizationSnapshot snapshot;

        Row(long ownerUserId, AuthorizationSnapshot snapshot) {
            this.ownerUserId = ownerUserId;
            this.snapshot = snapshot;
        }
    }

    /** 共享「数据库表」：所有实例读写同一份行状态（等价于同一个库）。 */
    private final Map<String, Row> table = new ConcurrentHashMap<>();

    private JdbcTemplate jdbc;
    private ConsentService consentService;

    @BeforeEach
    void wireSharedDatabaseSurface() {
        jdbc = mock(JdbcTemplate.class);
        // 权威读（guard 与 invoker step2 共用）：真实 store 的 SELECT 必须指向
        // vc.authorization_snapshot，并按 snapshot_id 取行。
        when(jdbc.query(anyString(),
                any(RowMapper.class),
                any(Object[].class)))
                .thenAnswer(inv -> {
                    String sql = inv.getArgument(0, String.class);
                    if (!sql.contains("FROM vc.authorization_snapshot")
                            || !sql.contains("WHERE snapshot_id = ?")) {
                        throw new IllegalStateException(
                                "authority read drifted from vc.authorization_snapshot: " + sql);
                    }
                    String snapshotId = inv.getArgument(2, String.class);
                    Row row = table.get(snapshotId);
                    return row == null ? List.<AuthorizationSnapshot>of()
                                       : List.of(row.snapshot);
                });
        // store.withdraw 的状态条件 UPDATE（仅撤回语义触达）。
        when(jdbc.update(anyString(), any(Object[].class)))
                .thenAnswer(inv -> {
                    String sql = inv.getArgument(0, String.class);
                    if (!sql.contains("SET status = 'WITHDRAWN'")) {
                        throw new IllegalStateException("unexpected update: " + sql);
                    }
                    return flipOneToWithdrawn(inv.getArgument(1, String.class));
                });
        // ConsentService.record 的 V41 追加行。
        when(jdbc.queryForObject(
                eq("SELECT vc.record_consent(?, ?, ?, ?)"), eq(Long.class), any(Object[].class)))
                .thenReturn(77L);
        // ConsentService.record 撤回分支的 V46 同事务全量翻转。
        when(jdbc.queryForObject(
                eq("SELECT vc.withdraw_authorization_snapshots(?)"),
                eq(Integer.class), any(Object[].class)))
                .thenAnswer(inv -> withdrawAllActive(inv.getArgument(2, Long.class)));
        consentService = new ConsentService(jdbc);
    }

    // ------------------------------------------------------------------
    // 主验收链：铸造快照 → 撤回同意 → 执行排队任务 → Provider HTTP 调用为 0
    // ------------------------------------------------------------------

    @Test
    void queuedTaskAfterConsentWithdrawalMakesZeroProviderCalls() {
        Instance instance = instance();
        // 铸造（V26 提交后的权威状态）。
        seedMintedSnapshots("snap-req-1", "snap-exec-1");
        // 修复前的进程内镜像副本：仍显示 ACTIVE —— 它不再是外发依据。
        instance.staleMirror.put(activeSnapshot("snap-req-1"));
        instance.staleMirror.put(activeSnapshot("snap-exec-1"));

        // 撤回前的第一次执行：正常放行一次外发。
        LiveAttemptOutcome first =
                instance.invoker.invoke(request("snap-req-1", "snap-exec-1"));
        assertEquals(LiveAttemptTerminal.SUCCEEDED, first.terminal());
        assertEquals(1, instance.adapter.openCount());

        // 用户撤回同意（同事务：V41 撤回行 + V46 翻转该 owner 全部 ACTIVE 快照）。
        consentService.record(OWNER, CONSENT_TYPE, CONSENT_VERSION, false);
        assertEquals(AuthorizationStatus.WITHDRAWN, storedStatus("snap-req-1"));
        assertEquals(AuthorizationStatus.WITHDRAWN, storedStatus("snap-exec-1"));

        // 执行排队任务：外发前复核权威双快照 → 拒绝；Provider HTTP 调用为 0。
        LiveAttemptOutcome second =
                instance.invoker.invoke(request("snap-req-1", "snap-exec-1"));
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, second.terminal());
        assertEquals(1, instance.adapter.openCount(),
                "withdrawn consent must add zero provider calls");
        assertTrue(second.audits().isEmpty(), "denied attempts carry no provider audit");
        assertEquals("", second.response());
    }

    /**
     * 多实例：两个独立实例只共享 DB 权威。实例 B 的撤回立即约束实例 A 的下一
     * 次外发——即使 A 本地还留有 ACTIVE 的旧镜像副本，也不会被救回。
     */
    @Test
    void withdrawalOnAnotherInstanceStopsThisInstancesQueuedTask() {
        Instance a = instance();
        Instance b = instance();
        seedMintedSnapshots("snap-req-m", "snap-exec-m");

        LiveAttemptOutcome before = a.invoker.invoke(request("snap-req-m", "snap-exec-m"));
        assertEquals(LiveAttemptTerminal.SUCCEEDED, before.terminal());
        assertEquals(1, a.adapter.openCount());

        // 实例 B（另一个进程）撤回同意。
        b.consentService.record(OWNER, CONSENT_TYPE, CONSENT_VERSION, false);

        // 实例 A 执行排队任务：读到 B 提交的 WITHDRAWN → 外发 0 次。
        LiveAttemptOutcome after = a.invoker.invoke(request("snap-req-m", "snap-exec-m"));
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, after.terminal());
        assertEquals(1, a.adapter.openCount(),
                "cross-instance withdrawal must block outbound");
        assertTrue(after.audits().isEmpty());
    }

    /**
     * 并发撤回：多个线程同时撤回（函数语义：先到者翻转、后到者 0 行、无异常），
     * 与此同时排队任务在执行——观察到的终态只能是 SUCCEEDED（竞态窗口内在
     * 撤回提交前完成授权决策）或 BLOCKED_BY_AUTHORIZATION；全部撤回提交后，
     * 后续执行一律阻断且不再产生外发；快照不复活。
     */
    @Test
    void concurrentWithdrawalsRaceTheWorkerWithoutExtraOutboundOrResurrection()
            throws Exception {
        Instance instance = instance();
        seedMintedSnapshots("snap-req-r", "snap-exec-r");

        int withdrawalThreads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(withdrawalThreads);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Long>> withdrawals = new ArrayList<>();
            for (int i = 0; i < withdrawalThreads; i++) {
                withdrawals.add(pool.submit(() -> {
                    start.await();
                    return instance.consentService.record(
                            OWNER, CONSENT_TYPE, CONSENT_VERSION, false);
                }));
            }

            AtomicInteger succeededDuringRace = new AtomicInteger();
            boolean[] seenBlocked = {false};
            start.countDown();
            while (withdrawals.stream().anyMatch(f -> !f.isDone())) {
                LiveAttemptOutcome outcome =
                        instance.invoker.invoke(request("snap-req-r", "snap-exec-r"));
                if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                    // 单向性：一旦见过一次阻断，绝不允许再放行（= 复活）。
                    assertFalse(seenBlocked[0],
                            "an authorization must never resurrect after denial");
                    succeededDuringRace.incrementAndGet();
                } else {
                    assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION,
                            outcome.terminal(),
                            "the race may only yield authorized-success or authorization-block");
                    seenBlocked[0] = true;
                }
            }

            for (Future<Long> withdrawal : withdrawals) {
                withdrawal.get(5, TimeUnit.SECONDS); // 无异常：函数语义幂等
            }

            // 全部撤回提交后：一律阻断，零新增外发。
            LiveAttemptOutcome finalOutcome =
                    instance.invoker.invoke(request("snap-req-r", "snap-exec-r"));
            assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION,
                    finalOutcome.terminal());
            assertEquals(succeededDuringRace.get(), instance.adapter.openCount(),
                    "every provider call must correspond to exactly one pre-withdrawal "
                            + "allowance; post-withdrawal executions add zero");

            // 不复活：再次撤回返回 0 行，状态保持 WITHDRAWN。
            assertEquals(0, withdrawAllActive(OWNER));
            assertEquals(AuthorizationStatus.WITHDRAWN, storedStatus("snap-req-r"));
            assertEquals(AuthorizationStatus.WITHDRAWN, storedStatus("snap-exec-r"));
        } finally {
            pool.shutdownNow();
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    /**
     * store 语义并发撤回（直接调 {@code JdbcAuthorizationSnapshotStore.withdraw}，
     * 如运维通道）：单向生命周期保证恰好一个赢家，其余因终态被拒；
     * 最终状态 WITHDRAWN 且不可复活。
     */
    @Test
    void concurrentDirectWithdrawalsHaveExactlyOneWinnerAndNeverResurrect() throws Exception {
        seedMintedSnapshots("snap-req-w", "snap-exec-w");
        JdbcAuthorizationSnapshotStore authority = new JdbcAuthorizationSnapshotStore(jdbc);

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Object>> attempts = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                attempts.add(pool.submit(() -> {
                    start.await();
                    try {
                        return authority.withdraw(new AuthorizationSnapshotId("snap-req-w"));
                    } catch (IllegalStateException rejected) {
                        return rejected; // 终态再撤回被拒（fail-closed 单向语义）
                    }
                }));
            }
            start.countDown();

            int winners = 0;
            int rejected = 0;
            for (Future<Object> attempt : attempts) {
                Object result = attempt.get(5, TimeUnit.SECONDS);
                if (result instanceof IllegalStateException) {
                    rejected++;
                } else {
                    winners++;
                    assertEquals(AuthorizationStatus.WITHDRAWN,
                            ((AuthorizationSnapshot) result).status());
                }
            }
            assertEquals(1, winners, "exactly one concurrent withdraw may win");
            assertEquals(threads - 1, rejected);

            // 不复活：状态保持 WITHDRAWN，后续 withdraw 返回 0 行并被拒。
            assertEquals(AuthorizationStatus.WITHDRAWN, storedStatus("snap-req-w"));
            assertThrows(IllegalStateException.class,
                    () -> authority.withdraw(new AuthorizationSnapshotId("snap-req-w")));
        } finally {
            pool.shutdownNow();
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    /**
     * 权威读取失败必须 fail-closed：DB 断连时外发被拒，绝不降级到本地镜像或
     * 放行（S0-25 验收第三条）。
     */
    @Test
    void unreadableAuthorityFailsClosedWithZeroProviderCalls() {
        Instance instance = instance();
        seedMintedSnapshots("snap-req-f", "snap-exec-f");
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenThrow(new DataAccessResourceFailureException("connection refused"));

        LiveAttemptOutcome outcome =
                instance.invoker.invoke(request("snap-req-f", "snap-exec-f"));

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertEquals(0, instance.adapter.openCount(),
                "unreadable authority must forbid outbound");
        assertTrue(outcome.audits().isEmpty());
    }

    /**
     * 历史审计可读：撤回后，权威行的完整内容仍可经同一权威读者查询（撤回是
     * 状态转换，不是抹除），但该快照不再授权任何外发。
     */
    @Test
    void withdrawnHistoryRemainsReadableThroughTheAuthority() {
        Instance instance = instance();
        seedMintedSnapshots("snap-req-h", "snap-exec-h");

        consentService.record(OWNER, CONSENT_TYPE, CONSENT_VERSION, false);

        var requested = instance.authorityStore.find(
                new AuthorizationSnapshotId("snap-req-h")).orElseThrow();
        assertEquals(AuthorizationStatus.WITHDRAWN, requested.status());
        assertEquals(PROVIDER, requested.providerId());
        assertEquals(REGION, requested.region());
        assertEquals(CONTRACT, requested.contractRef());
        assertEquals(CATEGORIES, requested.dataCategories());

        LiveAttemptOutcome outcome = instance.invoker.invoke(request("snap-req-h", "snap-exec-h"));
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(0, instance.adapter.openCount());
    }

    /**
     * 对照组（回归说明）：修复前的装配把 guard 指向进程内镜像——撤回后镜像仍
     * ACTIVE，外发会被放行。这正是 S0-25 要消灭的行为；现在 guard 读权威，
     * 同一场景被拒绝。
     */
    @Test
    void staleProcessLocalMirrorWouldHaveAllowedThePreFixBugButAuthorityDenies() {
        seedMintedSnapshots("snap-req-s", "snap-exec-s");
        consentService.record(OWNER, CONSENT_TYPE, CONSENT_VERSION, false);

        InMemoryAuthorizationSnapshotStore staleMirror = new InMemoryAuthorizationSnapshotStore();
        staleMirror.put(activeSnapshot("snap-req-s"));
        staleMirror.put(activeSnapshot("snap-exec-s"));

        ExecutionAuthorizationGuard preFixGuard =
                new ExecutionAuthorizationGuard(staleMirror, registryWithLoopback());
        ExecutionAuthorizationGuard currentGuard = new ExecutionAuthorizationGuard(
                new JdbcAuthorizationSnapshotStore(jdbc), registryWithLoopback());

        assertTrue(preFixGuard.authorize(binding("snap-req-s", "snap-exec-s")).allowed(),
                "documents the pre-S0-25 gap the mirror-based wiring allowed");
        var decision = currentGuard.authorize(binding("snap-req-s", "snap-exec-s"));
        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("WITHDRAWN"));
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    /** 一台「运行时实例」：guard 与 invoker 都接 DB 权威（S0-25 生产装配）。 */
    private static final class Instance {
        final JdbcAuthorizationSnapshotStore authorityStore;
        final LiveModelInvoker invoker;
        final CountingAdapter adapter;
        final InMemoryAuthorizationSnapshotStore staleMirror =
                new InMemoryAuthorizationSnapshotStore();
        final ConsentService consentService;

        Instance(JdbcTemplate sharedJdbc, ConsentService sharedConsentService) {
            this.consentService = sharedConsentService;
            CountingAdapter counting = new CountingAdapter();
            this.adapter = counting;
            InMemoryProviderRegistry registry = registryWithLoopback(counting);
            this.authorityStore = new JdbcAuthorizationSnapshotStore(sharedJdbc);
            ExecutionAuthorizationGuard guard =
                    new ExecutionAuthorizationGuard(authorityStore, registry);
            QuotaLedger ledger = new QuotaLedger();
            ledger.provision(OWNERSHIP.ownerUserId(), 1_000_000L);
            DeterministicRouter router = new DeterministicRouter(registry, ledger);
            GenerationRecovery recovery = new GenerationRecovery(ledger);
            AdapterLocator locator = new InMemoryAdapterLocator(List.of(registration(counting)));
            this.invoker = new LiveModelInvoker(
                    router, guard, authorityStore, locator, recovery,
                    Map.of(PROVIDER, "alpha-supplier"),
                    Map.of(PROVIDER, new com.virtualcompanion.modelruntime.execution.ProviderDeploymentMetadata(
                            "loopback-model", "loopback-rev-v1", "loopback-config-v1")));
        }
    }

    private Instance instance() {
        return new Instance(jdbc, consentService);
    }

    private static ProviderRegistration registration(ModelProtocolAdapter adapter) {
        return new ProviderRegistration(
                PROVIDER, adapter.protocol(), adapter.capabilities(), adapter);
    }

    private static InMemoryProviderRegistry registryWithLoopback() {
        return registryWithLoopback(new CountingAdapter());
    }

    private static InMemoryProviderRegistry registryWithLoopback(CountingAdapter adapter) {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration(adapter));
        return registry;
    }

    /** Provider HTTP 调用计数：每次 adapter.open 即一次真实外发尝试。 */
    private static final class CountingAdapter implements ModelProtocolAdapter {
        private final AtomicInteger opens = new AtomicInteger();
        private final LoopbackModelProtocolAdapter delegate = new LoopbackModelProtocolAdapter();

        int openCount() {
            return opens.get();
        }

        @Override
        public ModelProtocol protocol() {
            return delegate.protocol();
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return delegate.capabilities();
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            opens.incrementAndGet();
            return delegate.open(request);
        }
    }

    private void seedMintedSnapshots(String requestedId, String executionId) {
        table.put(requestedId, new Row(OWNER, activeSnapshot(requestedId)));
        table.put(executionId, new Row(OWNER, activeSnapshot(executionId)));
    }

    /** V46 函数语义：翻转该 owner 全部 ACTIVE 快照，返回翻转数（幂等、不抛）。 */
    private synchronized int withdrawAllActive(long ownerUserId) {
        int flipped = 0;
        for (Row row : List.copyOf(table.values())) {
            if (row.ownerUserId == ownerUserId
                    && row.snapshot.status() == AuthorizationStatus.ACTIVE) {
                row.snapshot = withdrawnCopy(row.snapshot);
                flipped++;
            }
        }
        return flipped;
    }

    /** V46/WITHDRAW SQL 语义：仅 ACTIVE 行翻转；非 ACTIVE/缺失返回 0 行。 */
    private synchronized int flipOneToWithdrawn(String snapshotId) {
        Row row = table.get(snapshotId);
        if (row == null || row.snapshot.status() != AuthorizationStatus.ACTIVE) {
            return 0;
        }
        row.snapshot = withdrawnCopy(row.snapshot);
        return 1;
    }

    private AuthorizationStatus storedStatus(String snapshotId) {
        Row row = table.get(snapshotId);
        return row == null ? null : row.snapshot.status();
    }

    private static AuthorizationSnapshot activeSnapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                PROVIDER,
                REGION,
                CONTRACT,
                ProcessingPurpose.COMPANION_CHAT,
                CATEGORIES,
                false,
                false);
    }

    private static AuthorizationSnapshot withdrawnCopy(AuthorizationSnapshot source) {
        return new AuthorizationSnapshot(
                source.id(),
                AuthorizationStatus.WITHDRAWN,
                source.providerId(),
                source.region(),
                source.contractRef(),
                source.purpose(),
                source.dataCategories(),
                source.taskCancelled(),
                source.sourceDataDeleted());
    }

    private static InvocationBinding.ExternalAttemptBinding binding(
            String requestedId, String executionId) {
        return new InvocationBinding.ExternalAttemptBinding(
                OWNERSHIP,
                "provider-attempt-1",
                1L,
                requestedId,
                executionId);
    }

    private static LiveInvocationRequest request(String requestedId, String executionId) {
        RoutingRequest routing = new RoutingRequest(
                OWNERSHIP,
                new Entitlement(OWNERSHIP.ownerUserId(), ServiceClass.simulated()),
                ModelProtocol.FAKE,
                new ModelProtocolCapabilities(Set.of()),
                requestedId,
                executionId,
                "ZERO_LLM_FALLBACK",
                42L);
        return new LiveInvocationRequest(
                routing,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "I had a rough day")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80),
                // S0-26: 纯历史对话外发必须声明逐条类别（单条 USER 文本）。
                com.virtualcompanion.modelruntime.execution.PayloadComposition
                        .allMessageText(1),
                "companion-chat-v1", "gentle-listener-v1");
    }
}
