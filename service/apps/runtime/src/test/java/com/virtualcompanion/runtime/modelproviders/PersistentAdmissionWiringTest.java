package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationDecision;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.registry.AdmissionStatus;
import com.virtualcompanion.modelruntime.registry.AuthorityGatedProviderRegistry;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import com.virtualcompanion.platform.persistence.JdbcProviderAdmissionAuthority;
import com.virtualcompanion.platform.persistence.JdbcProviderDeploymentRepository;
import com.virtualcompanion.platform.persistence.ProviderDeploymentRecord;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-11-A 装配：auth 数据源已接线时，运行期 registry 必须 overlay DB admission；
 * 未 admitted 的配置启用部署不得进入 findAdmitted。无数据源时保持进程内
 * register-as-admitted 退化路径，避免无 DB 测试上下文依赖 PostgreSQL。
 */
class PersistentAdmissionWiringTest {

    private static final ProviderId PROVIDER = new ProviderId("openai-approved");

    @Test
    void dbAuthorityIsSelectedWhenTheAuthDatasourceIsWired() {
        JdbcProviderAdmissionAuthority db = authorityReturning(
                new ProviderDeploymentRecord(
                        PROVIDER.value(), "FAKE", List.of(), "ADMITTED"));
        InMemoryProviderRegistry inner = admittedInner();

        ProviderRegistry selected = ApprovedModelProviderConfig.durableAdmissionRegistry(inner, db);

        assertTrue(selected instanceof AuthorityGatedProviderRegistry);
        assertTrue(selected.findAdmitted(
                ModelProtocol.FAKE, new ModelProtocolCapabilities(Set.of())).isPresent());
    }

    @Test
    void configEnabledDeploymentIsNotAdmittedWhenDbRowIsMissing() {
        JdbcProviderAdmissionAuthority db = authorityReturning(null);
        ProviderRegistry selected = ApprovedModelProviderConfig.durableAdmissionRegistry(
                admittedInner(), db);

        assertTrue(selected.findAdmitted(
                ModelProtocol.FAKE, new ModelProtocolCapabilities(Set.of())).isEmpty());
        assertFalse(selected.deployments().getFirst().isAdmitted());
    }

    @Test
    void configEnabledDeploymentIsNotAdmittedWhenDbRowIsDisabled() {
        JdbcProviderAdmissionAuthority db = authorityReturning(
                new ProviderDeploymentRecord(
                        PROVIDER.value(), "FAKE", List.of(), "DISABLED"));
        ProviderRegistry selected = ApprovedModelProviderConfig.durableAdmissionRegistry(
                admittedInner(), db);

        assertTrue(selected.findAdmitted(
                ModelProtocol.FAKE, new ModelProtocolCapabilities(Set.of())).isEmpty());
        assertEquals(AdmissionStatus.DISABLED, selected.deployments().getFirst().admissionStatus());
    }

    @Test
    void guardDeniesOutboundWhenDurableAdmissionIsDisabled() {
        JdbcProviderAdmissionAuthority db = authorityReturning(
                new ProviderDeploymentRecord(
                        PROVIDER.value(), "FAKE", List.of(), "DISABLED"));
        ProviderRegistry registry = ApprovedModelProviderConfig.durableAdmissionRegistry(
                admittedInner(), db);

        InMemoryAuthorizationSnapshotStore snapshots = new InMemoryAuthorizationSnapshotStore();
        snapshots.put(activeSnapshot("snap-req-g"));
        snapshots.put(activeSnapshot("snap-exec-g"));
        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(snapshots, registry);

        ExecutionAuthorizationDecision decision = guard.authorize(
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple("1", "9", "5", "10"),
                        "pa-1",
                        1L,
                        "snap-req-g",
                        "snap-exec-g"));
        assertFalse(decision.allowed());
        assertTrue(decision.denialReason().contains("not admitted"));
    }

    @Test
    void degenerateNoDatasourceWiringKeepsProcessLocalRegistry() {
        InMemoryProviderRegistry inner = admittedInner();
        ProviderRegistry selected =
                ApprovedModelProviderConfig.durableAdmissionRegistry(inner, null);
        assertSame(inner, selected);
        assertTrue(selected.findAdmitted(
                ModelProtocol.FAKE, new ModelProtocolCapabilities(Set.of())).isPresent());
    }

    private static InMemoryProviderRegistry admittedInner() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(new ProviderRegistration(
                PROVIDER,
                ModelProtocol.FAKE,
                new ModelProtocolCapabilities(Set.of()),
                new StubAdapter()));
        return registry;
    }

    private static JdbcProviderAdmissionAuthority authorityReturning(ProviderDeploymentRecord row) {
        JdbcProviderDeploymentRepository repository = new JdbcProviderDeploymentRepository(
                Mockito.mock(JdbcTemplate.class)) {
            @Override
            public Optional<ProviderDeploymentRecord> findByProviderId(String providerId) {
                if (row != null && row.providerId().equals(providerId)) {
                    return Optional.of(row);
                }
                return Optional.empty();
            }
        };
        return new JdbcProviderAdmissionAuthority(repository);
    }

    private static AuthorizationSnapshot activeSnapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                PROVIDER,
                new ProviderRegion("us"),
                new ProviderContractRef("alpha-standard"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false);
    }

    private static final class StubAdapter implements ModelProtocolAdapter {
        @Override
        public ModelProtocol protocol() {
            return ModelProtocol.FAKE;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return new ModelProtocolCapabilities(Set.of());
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("wiring test never opens a session");
        }
    }
}
