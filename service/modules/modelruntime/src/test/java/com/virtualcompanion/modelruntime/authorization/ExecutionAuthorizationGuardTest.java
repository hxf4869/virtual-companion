package com.virtualcompanion.modelruntime.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ExecutionAuthorizationGuardTest {

    private InMemoryAuthorizationSnapshotStore store;
    private InMemoryProviderRegistry registry;
    private ExecutionAuthorizationGuard guard;
    private ProviderId providerId;

    @BeforeEach
    void setUp() {
        store = new InMemoryAuthorizationSnapshotStore();
        registry = new InMemoryProviderRegistry();
        providerId = new ProviderId("fake-provider");
        ModelProtocolCapabilities caps =
                new ModelProtocolCapabilities(Set.of(ModelProtocolCapabilities.Capability.STREAMING));
        registry.register(new ProviderRegistration(
                providerId,
                ModelProtocol.FAKE,
                caps,
                new StubAdapter(ModelProtocol.FAKE, caps)
        ));
        guard = new ExecutionAuthorizationGuard(store, registry);
    }

    @Test
    void allowsWhenRequestedAndExecutionSnapshotsAreActiveAndAligned() {
        AuthorizationSnapshot requested = activeSnapshot("req-1");
        AuthorizationSnapshot execution = activeSnapshot("exec-1");
        store.put(requested);
        store.put(execution);

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertTrue(decision.allowed());
        assertTrue(decision.externalDataTransferAllowed());
        assertEquals(QuotaAction.NONE, decision.quotaAction());
    }

    @Test
    void deniesWhenRequestedSnapshotIsWithdrawn() {
        store.put(activeSnapshot("req-1"));
        store.put(activeSnapshot("exec-1"));
        store.withdraw(new AuthorizationSnapshotId("req-1"));

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertFalse(decision.externalDataTransferAllowed());
        assertEquals(QuotaAction.RELEASE, decision.quotaAction());
        assertTrue(decision.denialReason().contains("WITHDRAWN"));
    }

    @Test
    void deniesWhenExecutionSnapshotIsNarrowed() {
        store.put(activeSnapshot("req-1"));
        AuthorizationSnapshot exec = activeSnapshot("exec-1");
        store.put(exec);
        store.narrow(
                exec.id(),
                new AuthorizationSnapshot(
                        exec.id(),
                        AuthorizationStatus.ACTIVE,
                        exec.providerId(),
                        exec.region(),
                        exec.contractRef(),
                        exec.purpose(),
                        Set.of(DataCategory.MESSAGE_TEXT),
                        false,
                        false
                )
        );

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertEquals(QuotaAction.RELEASE, decision.quotaAction());
        assertTrue(decision.denialReason().contains("NARROWED"));
    }

    @Test
    void deniesWhenTaskCancelledOnExecutionSnapshot() {
        store.put(activeSnapshot("req-1"));
        store.put(new AuthorizationSnapshot(
                new AuthorizationSnapshotId("exec-1"),
                AuthorizationStatus.ACTIVE,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                true,
                false
        ));

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("cancelled"));
        assertEquals(QuotaAction.RELEASE, decision.quotaAction());
    }

    @Test
    void deniesWhenSourceDataDeleted() {
        store.put(activeSnapshot("req-1"));
        store.put(new AuthorizationSnapshot(
                new AuthorizationSnapshotId("exec-1"),
                AuthorizationStatus.ACTIVE,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                true
        ));

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("source data deleted"));
    }

    @Test
    void deniesWhenProviderIsDisabledInRegistry() {
        store.put(activeSnapshot("req-1"));
        store.put(activeSnapshot("exec-1"));
        registry.disable(providerId);

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("not admitted"));
        assertFalse(decision.externalDataTransferAllowed());
    }

    @Test
    void deniesWhenExecutionDataCategoriesExceedRequested() {
        store.put(new AuthorizationSnapshot(
                new AuthorizationSnapshotId("req-1"),
                AuthorizationStatus.ACTIVE,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false
        ));
        store.put(new AuthorizationSnapshot(
                new AuthorizationSnapshotId("exec-1"),
                AuthorizationStatus.ACTIVE,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT, DataCategory.MEMORY_SNIPPET),
                false,
                false
        ));

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("req-1", "exec-1")
        );

        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("data categories exceed"));
    }

    @Test
    void deniesWhenRequestedSnapshotMissing() {
        store.put(activeSnapshot("exec-1"));

        ExecutionAuthorizationDecision decision = guard.authorize(
                binding("missing", "exec-1")
        );

        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("requested snapshot missing"));
    }

    @Test
    void externalAttemptBindingRequiresBothSnapshotIds() {
        assertThrows(IllegalArgumentException.class, () ->
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple("o", "r", "c", "g"),
                        "attempt",
                        0L,
                        "   ",
                        "exec"
                ));
        assertThrows(IllegalArgumentException.class, () ->
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple("o", "r", "c", "g"),
                        "attempt",
                        0L,
                        "req",
                        ""
                ));
    }

    @Test
    void withdrawDoesNotAllowReuseForPendingWork() {
        store.put(activeSnapshot("req-1"));
        store.put(activeSnapshot("exec-1"));
        assertTrue(guard.authorize(binding("req-1", "exec-1")).allowed());

        store.withdraw(new AuthorizationSnapshotId("req-1"));

        ExecutionAuthorizationDecision after = guard.authorize(binding("req-1", "exec-1"));
        assertFalse(after.allowed());
        assertEquals(QuotaAction.RELEASE, after.quotaAction());
        assertFalse(after.externalDataTransferAllowed());
    }

    @Test
    void consentCoverageHelperRequiresPurposeAndCategories() {
        AuthorizationSnapshot snapshot = activeSnapshot("req-1");
        assertTrue(ExecutionAuthorizationGuard.currentConsentCovers(
                snapshot,
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT)
        ));
        assertFalse(ExecutionAuthorizationGuard.currentConsentCovers(
                snapshot,
                ProcessingPurpose.MEMORY_EXTRACT,
                Set.of(DataCategory.MESSAGE_TEXT)
        ));
    }

    /**
     * S0-25: an unreadable authority read denies the attempt instead of
     * failing open or falling back to any stale local state. Distinct from an
     * authoritative "missing" so audits name the real failure mode.
     */
    @Test
    void requestedAuthorityReadFailureDeniesFailClosed() {
        ExecutionAuthorizationGuard failing =
                new ExecutionAuthorizationGuard(throwingStore(new IllegalStateException("db down")), registry);

        ExecutionAuthorizationDecision decision = failing.authorize(binding("req-1", "exec-1"));

        assertFalse(decision.allowed());
        assertFalse(decision.externalDataTransferAllowed());
        assertEquals(QuotaAction.RELEASE, decision.quotaAction());
        assertTrue(decision.denialReason().contains("requested snapshot authority read failed"));
    }

    @Test
    void executionAuthorityReadFailureDeniesFailClosed() {
        // The requested read succeeds; the execution read throws — the second
        // authority lookup must also fail closed.
        store.put(activeSnapshot("req-1"));
        ExecutionAuthorizationGuard flaky = new ExecutionAuthorizationGuard(
                new AuthorizationSnapshotStore() {
                    private int calls;

                    @Override
                    public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
                        throw new UnsupportedOperationException("not used");
                    }

                    @Override
                    public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
                        if (++calls == 1) {
                            return Optional.of(activeSnapshot(id.value()));
                        }
                        throw new java.util.concurrent.RejectedExecutionException("pool exhausted");
                    }

                    @Override
                    public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
                        throw new UnsupportedOperationException("not used");
                    }

                    @Override
                    public AuthorizationSnapshot narrow(
                            AuthorizationSnapshotId id, AuthorizationSnapshot narrowed) {
                        throw new UnsupportedOperationException("not used");
                    }
                },
                registry);

        ExecutionAuthorizationDecision decision = flaky.authorize(binding("req-1", "exec-1"));

        assertFalse(decision.allowed());
        assertFalse(decision.externalDataTransferAllowed());
        assertEquals(QuotaAction.RELEASE, decision.quotaAction());
        assertTrue(decision.denialReason().contains("execution snapshot authority read failed"));
    }

    @Test
    void authorityRecoversAfterTransientFailureWithoutStaleCache() {
        // A failed read must not poison or cache anything: once the authority
        // answers again, the decision reflects its current state.
        AtomicBoolean healthy = new AtomicBoolean(false);
        ExecutionAuthorizationGuard recovering = new ExecutionAuthorizationGuard(
                new AuthorizationSnapshotStore() {
                    @Override
                    public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
                        throw new UnsupportedOperationException("not used");
                    }

                    @Override
                    public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
                        if (!healthy.get()) {
                            throw new IllegalStateException("db down");
                        }
                        return Optional.of(withdrawnSnapshot(id.value()));
                    }

                    @Override
                    public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
                        throw new UnsupportedOperationException("not used");
                    }

                    @Override
                    public AuthorizationSnapshot narrow(
                            AuthorizationSnapshotId id, AuthorizationSnapshot narrowed) {
                        throw new UnsupportedOperationException("not used");
                    }
                },
                registry);

        assertFalse(recovering.authorize(binding("req-1", "exec-1")).allowed());

        healthy.set(true);
        ExecutionAuthorizationDecision after = recovering.authorize(binding("req-1", "exec-1"));
        assertFalse(after.allowed());
        assertTrue(after.denialReason().contains("WITHDRAWN"));
    }

    private static AuthorizationSnapshotStore throwingStore(RuntimeException failure) {
        return new AuthorizationSnapshotStore() {
            @Override
            public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
                throw new UnsupportedOperationException("not used");
            }

            @Override
            public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
                throw failure;
            }

            @Override
            public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
                throw new UnsupportedOperationException("not used");
            }

            @Override
            public AuthorizationSnapshot narrow(
                    AuthorizationSnapshotId id, AuthorizationSnapshot narrowed) {
                throw new UnsupportedOperationException("not used");
            }
        };
    }

    private AuthorizationSnapshot withdrawnSnapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.WITHDRAWN,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false
        );
    }

    private AuthorizationSnapshot activeSnapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                providerId,
                new ProviderRegion("local"),
                new ProviderContractRef("contract-a"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT, DataCategory.USAGE_METADATA),
                false,
                false
        );
    }

    private static InvocationBinding.ExternalAttemptBinding binding(
            String requestedId,
            String executionId
    ) {
        return new InvocationBinding.ExternalAttemptBinding(
                new OwnershipTuple("owner", "relationship", "conversation", "generation"),
                "provider-attempt-1",
                1L,
                requestedId,
                executionId
        );
    }

    private static final class StubAdapter implements ModelProtocolAdapter {
        private final ModelProtocol protocol;
        private final ModelProtocolCapabilities capabilities;

        StubAdapter(ModelProtocol protocol, ModelProtocolCapabilities capabilities) {
            this.protocol = protocol;
            this.capabilities = capabilities;
        }

        @Override
        public ModelProtocol protocol() {
            return protocol;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return capabilities;
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("not used");
        }
    }
}
