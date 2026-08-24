package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import com.virtualcompanion.platform.persistence.ProviderRollbackService;
import com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders;
import java.util.List;
import java.util.Objects;

/**
 * S0-24-C: converts a supplier circuit trip into a durable, audited rollback.
 *
 * <p>The in-process breaker remains the immediate outbound stop. This listener
 * additionally disables every configured deployment for that supplier through
 * the database SECURITY DEFINER seam so a runtime restart cannot silently
 * re-admit it. Messages deliberately omit provider ids, endpoints and account
 * identifiers; detailed fixed-code history stays in the restricted database.
 */
public final class DurableProviderRollbackListener {

    static final String TRIGGER_CONSECUTIVE_FAILURES = "CONSECUTIVE_FAILURES";
    static final String ACTOR_AUTO = "AUTO";

    public DurableProviderRollbackListener(
            SupplierCircuitBreaker circuitBreaker,
            ApprovedModelProviders providers,
            ProviderRollbackService rollbackService,
            AlertNotifier alertNotifier) {
        Objects.requireNonNull(circuitBreaker, "circuitBreaker must not be null");
        Objects.requireNonNull(providers, "providers must not be null");
        Objects.requireNonNull(rollbackService, "rollbackService must not be null");
        Objects.requireNonNull(alertNotifier, "alertNotifier must not be null");
        circuitBreaker.onOpened(supplier -> rollbackSupplier(
                supplier, providers, rollbackService, alertNotifier));
    }

    static void rollbackSupplier(
            String supplier,
            ApprovedModelProviders providers,
            ProviderRollbackService rollbackService,
            AlertNotifier alertNotifier) {
        List<String> providerIds = providers.supplierNames().entrySet().stream()
                .filter(entry -> Objects.equals(entry.getValue(), supplier))
                .map(entry -> entry.getKey().value())
                .sorted()
                .toList();
        if (providerIds.isEmpty()) {
            alertNotifier.alert(
                    AlertSeverity.P0,
                    "PROVIDER_DURABLE_ROLLBACK_FAILED",
                    "provider circuit opened but no configured deployment matched; outbound remains process-blocked");
            return;
        }

        boolean changed = false;
        for (String providerId : providerIds) {
            try {
                ProviderRollbackService.RollbackResult result = rollbackService.rollback(
                        providerId, TRIGGER_CONSECUTIVE_FAILURES, ACTOR_AUTO);
                changed |= result.changed();
            } catch (RuntimeException failure) {
                alertNotifier.alert(
                        AlertSeverity.P0,
                        "PROVIDER_DURABLE_ROLLBACK_FAILED",
                        "provider circuit opened but durable disable failed; outbound remains process-blocked");
                return;
            }
        }
        alertNotifier.alert(
                AlertSeverity.P1,
                "PROVIDER_DURABLE_ROLLBACK",
                changed
                        ? "provider circuit threshold reached; configured deployment was durably disabled"
                        : "provider circuit threshold reached; configured deployment was already disabled");
    }
}
