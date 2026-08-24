package com.virtualcompanion.runtime.servicemode;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.runtime.modelproviders.ModelProviderProperties;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link ServiceModeService} (SVC-MODE / FR-RES-005): the mode
 * is a pure function of the provider master switch, the summary is plain
 * operational copy, and no other catalog mode is ever reported.
 */
class ServiceModeServiceTest {

    private static ModelProviderProperties providers(boolean enabled) {
        return providers(enabled, false);
    }

    private static ModelProviderProperties providers(boolean enabled, boolean degraded) {
        return new ModelProviderProperties(enabled, "/run/secrets", List.of(), degraded);
    }

    @SuppressWarnings("unchecked")
    private static <T> org.springframework.beans.factory.ObjectProvider<T> optional(T value) {
        org.springframework.beans.factory.ObjectProvider<T> provider =
                org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }

    @Test
    void disabledMasterSwitchReportsZeroLlm() {
        ServiceModeService service = new ServiceModeService(providers(false));

        ServiceModeService.Status status = service.current();

        assertThat(status.mode()).isEqualTo("ZERO_LLM");
        assertThat(status.summary()).isNotBlank();
        assertThat(status.summary()).contains("受限");
    }

    @Test
    void enabledMasterSwitchReportsFullAi() {
        ServiceModeService service = new ServiceModeService(providers(true));

        ServiceModeService.Status status = service.current();

        assertThat(status.mode()).isEqualTo("FULL_AI");
        assertThat(status.summary()).isNotBlank();
    }

    @Test
    void statusRejectsBlankFields() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new ServiceModeService.Status("  ", "summary"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new ServiceModeService.Status("FULL_AI", " "));
    }

    @Test
    void enabledAndDegradedReportsDegradedAi() {
        ServiceModeService service = new ServiceModeService(providers(true, true));

        ServiceModeService.Status status = service.current();

        assertThat(status.mode()).isEqualTo("DEGRADED_AI");
        assertThat(status.summary()).contains("降级");
    }

    @Test
    void blockedSupplierDegradesAndAllBlockedBecomesZeroLlm() {
        com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker breaker =
                new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 60_000);
        breaker.success("anthropic");
        breaker.failure("openai");
        org.springframework.beans.factory.ObjectProvider<
                com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker> provider =
                org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(provider.getIfAvailable()).thenReturn(breaker);

        ServiceModeService degraded = new ServiceModeService(providers(true), provider);
        assertThat(degraded.current().mode()).isEqualTo("DEGRADED_AI");

        breaker.failure("anthropic");
        assertThat(degraded.current().mode()).isEqualTo("ZERO_LLM");
    }

    @Test
    void durableRegistryWithNoAdmittedDeploymentIsNotReportedAsFull() {
        com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders approved =
                org.mockito.Mockito.mock(
                        com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders.class);
        com.virtualcompanion.modelruntime.registry.ProviderRegistry registry =
                org.mockito.Mockito.mock(com.virtualcompanion.modelruntime.registry.ProviderRegistry.class);
        org.mockito.Mockito.when(approved.registry()).thenReturn(registry);
        org.mockito.Mockito.when(registry.deployments()).thenReturn(List.of());
        ServiceModeService service = new ServiceModeService(
                providers(true),
                optional((com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker) null),
                optional(approved),
                optional((com.virtualcompanion.modelruntime.execution.BudgetGuard) null),
                optional((com.virtualcompanion.platform.persistence.ReleaseGate) null),
                optional((BetaServiceWindow) null),
                true, true);

        assertThat(service.current(7L).mode()).isEqualTo("ZERO_LLM");
    }

    @Test
    void budgetHaltAndUnreadableBudgetFailClosed() {
        var exceeded = new com.virtualcompanion.modelruntime.execution.BudgetGuard(
                () -> 10.0, 5.0);
        ServiceModeService halted = new ServiceModeService(
                providers(true), optional(null), optional(null), optional(exceeded),
                optional(null), optional(null), true, true);
        assertThat(halted.current(7L).mode()).isEqualTo("ZERO_LLM");

        var unreadable = new com.virtualcompanion.modelruntime.execution.BudgetGuard(
                () -> { throw new IllegalStateException("db down"); }, 5.0);
        ServiceModeService failed = new ServiceModeService(
                providers(true), optional(null), optional(null), optional(unreadable),
                optional(null), optional(null), true, true);
        assertThat(failed.current(7L).mode()).isEqualTo("ZERO_LLM");
    }

    @Test
    void manualPauseAndReleaseDenialReportMaintenance() {
        BetaServiceWindow paused = new BetaServiceWindow(
                true, true, "10:00", "22:00", 1, "Asia/Shanghai");
        ServiceModeService pausedService = new ServiceModeService(
                providers(true), optional(null), optional(null), optional(null),
                optional(null), optional(paused), true, true);
        assertThat(pausedService.current(7L).mode()).isEqualTo("MAINTENANCE");

        com.virtualcompanion.platform.persistence.ReleaseGate gate =
                org.mockito.Mockito.mock(com.virtualcompanion.platform.persistence.ReleaseGate.class);
        org.mockito.Mockito.when(gate.allowsGenerationFor(7L)).thenReturn(false);
        ServiceModeService denied = new ServiceModeService(
                providers(true), optional(null), optional(null), optional(null),
                optional(gate), optional(null), true, true);
        assertThat(denied.current(7L).mode()).isEqualTo("MAINTENANCE");
    }

    @Test
    void absentZeroLlmFallbackUsesMaintenanceInsteadOfInventingAvailability() {
        ServiceModeService service = new ServiceModeService(
                providers(false), optional(null), optional(null), optional(null),
                optional(null), optional(null), true, false);
        assertThat(service.current(7L).mode()).isEqualTo("MAINTENANCE");
    }
}
