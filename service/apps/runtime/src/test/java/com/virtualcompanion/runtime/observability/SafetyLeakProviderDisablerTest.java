package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.ProviderRollbackService;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-05 (ADR-0006 §3.4): an R4 final-output verdict durably disables
 * the serving deployment through the V98 SAFETY_LEAK seam and raises a P1;
 * a rollback failure degrades to a P0 instead of throwing into the worker.
 */
class SafetyLeakProviderDisablerTest {

    @Test
    void r4VerdictDurablyDisablesTheDeploymentAndAlertsP1() {
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        ProviderRollbackService.RollbackResult result =
                mock(ProviderRollbackService.RollbackResult.class);
        when(result.changed()).thenReturn(true);
        when(rollback.rollback("provider-a", "SAFETY_LEAK", "OPERATOR")).thenReturn(result);
        AlertNotifier alerts = mock(AlertNotifier.class);
        SafetyLeakProviderDisabler disabler = new SafetyLeakProviderDisabler(rollback, alerts);

        disabler.disableDeployment("provider-a");

        verify(rollback).rollback("provider-a", "SAFETY_LEAK", "OPERATOR");
        verify(alerts).alert(
                eq(AlertSeverity.P1),
                eq("PROVIDER_SAFETY_LEAK_DISABLED"),
                contains("durably disabled"));
    }

    @Test
    void rollbackFailureDegradesToP0AndNeverThrows() {
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        when(rollback.rollback("provider-a", "SAFETY_LEAK", "OPERATOR"))
                .thenThrow(new IllegalStateException("database unavailable"));
        AlertNotifier alerts = mock(AlertNotifier.class);
        SafetyLeakProviderDisabler disabler = new SafetyLeakProviderDisabler(rollback, alerts);

        disabler.disableDeployment("provider-a");

        verify(alerts).alert(
                eq(AlertSeverity.P0),
                eq("PROVIDER_SAFETY_LEAK_DISABLE_FAILED"),
                contains("manual owner action"));
    }

    @Test
    void rollbackFailureLocallyIsolatesTheExactDeployment() {
        // DOGFOOD-STABILIZATION audit (ADR-0006 §3.4): when the durable
        // rollback write fails, the current runtime must immediately isolate
        // that exact deployment so the next routing attempt has zero egress.
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        when(rollback.rollback("provider-a", "SAFETY_LEAK", "OPERATOR"))
                .thenThrow(new IllegalStateException("database unavailable"));
        AlertNotifier alerts = mock(AlertNotifier.class);
        com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation isolation =
                new com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation();
        SafetyLeakProviderDisabler disabler =
                new SafetyLeakProviderDisabler(rollback, alerts, isolation);

        disabler.disableDeployment("provider-a");

        assertThat(isolation.isIsolated("provider-a")).isTrue();
        assertThat(isolation.isIsolated("another-provider")).isFalse();
    }

    @Test
    void successfulDurableRollbackDoesNotLocallyIsolate() {
        ProviderRollbackService rollback = mock(ProviderRollbackService.class);
        ProviderRollbackService.RollbackResult result =
                mock(ProviderRollbackService.RollbackResult.class);
        when(result.changed()).thenReturn(true);
        when(rollback.rollback("provider-a", "SAFETY_LEAK", "OPERATOR")).thenReturn(result);
        AlertNotifier alerts = mock(AlertNotifier.class);
        com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation isolation =
                new com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation();
        SafetyLeakProviderDisabler disabler =
                new SafetyLeakProviderDisabler(rollback, alerts, isolation);

        disabler.disableDeployment("provider-a");

        assertThat(isolation.size()).isZero();
    }

    @Test
    void alertMessagesNeverCarryTheProviderId() {
        assertThat(SafetyLeakProviderDisabler.ALERT_MESSAGE_DISABLED)
                .doesNotContain("provider-a");
        assertThat(SafetyLeakProviderDisabler.ALERT_MESSAGE_DISABLE_FAILED)
                .doesNotContain("provider-a");
    }
}
