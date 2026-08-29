package com.virtualcompanion.runtime.observability;

import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.platform.persistence.ProviderRollbackService;
import com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Java runtime until Go generation cutover (ADR-0006 §3.4): consecutive
 * supplier failures durable-disable matching deployments.
 *
 * <p>Go v1 (ADR-0007 / model-protocol-contract goV1.providerDisable): ordinary
 * 429/5xx/timeout stay per-request; only a safety leak, an explicitly invalid
 * credential, or an Owner operation may durable-disable. These assertions
 * document current Java behaviour and are not the Go target contract.
 */
class DurableProviderRollbackListenerTest {

    @Test
    void circuitTripDurablyDisablesEveryDeploymentForTheSupplier() {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(1, 60_000);
        ApprovedModelProviders providers = mock(ApprovedModelProviders.class);
        when(providers.supplierNames()).thenReturn(Map.of(
                new ProviderId("provider-b"), "supplier-a",
                new ProviderId("provider-a"), "supplier-a",
                new ProviderId("provider-c"), "supplier-other"));
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        ProviderRollbackService.RollbackResult changed = mock(ProviderRollbackService.RollbackResult.class);
        when(changed.changed()).thenReturn(true);
        when(rollback.rollback(
                org.mockito.ArgumentMatchers.anyString(),
                eq("CONSECUTIVE_FAILURES"),
                eq("AUTO"))).thenReturn(changed);
        AlertNotifier alerts = mock(AlertNotifier.class);
        new DurableProviderRollbackListener(breaker, providers, rollback, alerts);

        breaker.failure("supplier-a");

        verify(rollback).rollback("provider-a", "CONSECUTIVE_FAILURES", "AUTO");
        verify(rollback).rollback("provider-b", "CONSECUTIVE_FAILURES", "AUTO");
        verify(rollback, never()).rollback("provider-c", "CONSECUTIVE_FAILURES", "AUTO");
        verify(alerts).alert(
                eq(AlertSeverity.P1),
                eq("PROVIDER_DURABLE_ROLLBACK"),
                contains("durably disabled"));
    }

    @Test
    void missingSupplierMappingRaisesGenericP0WithoutLeakingAnIdentifier() {
        ApprovedModelProviders providers = mock(ApprovedModelProviders.class);
        when(providers.supplierNames()).thenReturn(Map.of());
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        AlertNotifier alerts = mock(AlertNotifier.class);

        DurableProviderRollbackListener.rollbackSupplier(
                "private-supplier-label", providers, rollback, alerts);

        verify(rollback, never()).rollback(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString());
        verify(alerts).alert(
                eq(AlertSeverity.P0),
                eq("PROVIDER_DURABLE_ROLLBACK_FAILED"),
                eq("provider circuit opened but no configured deployment matched; outbound remains process-blocked"));
    }

    @Test
    void databaseFailureKeepsProcessBlockAndRaisesGenericP0() {
        ApprovedModelProviders providers = mock(ApprovedModelProviders.class);
        when(providers.supplierNames()).thenReturn(Map.of(
                new ProviderId("provider-a"), "supplier-a"));
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        when(rollback.rollback("provider-a", "CONSECUTIVE_FAILURES", "AUTO"))
                .thenThrow(new IllegalStateException("database unavailable"));
        AlertNotifier alerts = mock(AlertNotifier.class);

        DurableProviderRollbackListener.rollbackSupplier(
                "supplier-a", providers, rollback, alerts);

        verify(alerts).alert(
                eq(AlertSeverity.P0),
                eq("PROVIDER_DURABLE_ROLLBACK_FAILED"),
                eq("provider circuit opened but durable disable failed; outbound remains process-blocked"));
    }
}
