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
import java.util.Set;
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
