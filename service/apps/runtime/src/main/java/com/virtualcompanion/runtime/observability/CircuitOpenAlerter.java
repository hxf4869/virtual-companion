package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import org.springframework.stereotype.Component;

/**
 * ROUTE-HARDEN (§12.12): registers the CLOSED→OPEN trip alert on the shared
 * supplier circuit breaker. Lives in the observability slice because the
 * Modulith slice rule forbids {@code modelproviders → observability}
 * (servicemode → modelproviders and observability → servicemode already
 * exist); inverting the registration keeps the slices acyclic.
 *
 * <p>A trip raises a throttled P2 {@code PROVIDER_CIRCUIT_OPEN} alert
 * (registered in docs/beta-readiness/07 §3). A failed half-open probe re-opens
 * silently — the outage is already known and the 60s throttle would swallow
 * it anyway.
 */
@Component
public class CircuitOpenAlerter {

    public CircuitOpenAlerter(SupplierCircuitBreaker circuitBreaker, AlertNotifier alertNotifier) {
        circuitBreaker.onOpened(supplier -> alertNotifier.alert(
                AlertSeverity.P2,
                "PROVIDER_CIRCUIT_OPEN",
                "supplier '" + supplier + "' tripped OPEN after consecutive failures;"
                        + " routing fails over / degrades until the half-open probe succeeds"));
    }
}
