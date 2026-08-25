package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.platform.persistence.ProviderRollbackService;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * DOGFOOD-05 (ADR-0006 §3.4): durable disable of a provider deployment whose
 * final output was classified {@code R4_IMMINENT}.
 *
 * <p>Operationalized definition of a "safety leak" (口径): the FINAL output
 * review of a completed real provider attempt returns risk level R4 — whether
 * the verdict came from the local deterministic rules or the remote
 * classification leg. The deployment that actually served the attempt is
 * durably disabled through {@code vc.rollback_provider_deployment}
 * (trigger {@code SAFETY_LEAK}). V98's audit constraints record SAFETY_LEAK
 * rollbacks with actor code {@code OPERATOR} — in the Owner-only dogfood the
 * runtime acts as the single Owner's automated operator action, and recovery
 * (re-admission) stays a manual Owner decision exactly as ADR §3.4 requires.
 * The message never carries provider ids, endpoints or account identifiers;
 * the fixed-code history in the restricted database keeps the audit trail.</p>
 */
public final class SafetyLeakProviderDisabler {

    static final String TRIGGER_SAFETY_LEAK = "SAFETY_LEAK";
    static final String ACTOR_OPERATOR = "OPERATOR";
    static final String ALERT_CODE_DISABLED = "PROVIDER_SAFETY_LEAK_DISABLED";
    static final String ALERT_MESSAGE_DISABLED =
            "final output review classified R4_IMMINENT; the deployment was durably disabled; "
                    + "re-enabling is a manual owner decision";
    static final String ALERT_CODE_DISABLE_FAILED = "PROVIDER_SAFETY_LEAK_DISABLE_FAILED";
    static final String ALERT_MESSAGE_DISABLE_FAILED =
            "final output review classified R4_IMMINENT but the durable disable failed; "
                    + "the output stays blocked; manual owner action is required";

    private static final Logger log = LoggerFactory.getLogger(SafetyLeakProviderDisabler.class);

    private final ProviderRollbackService rollbackService;
    private final AlertNotifier alertNotifier;
    /**
     * DOGFOOD-STABILIZATION audit: in-process backstop for the exact
     * deployment when the durable rollback write itself fails — the next
     * routing attempt must see no eligible deployment (zero egress) even
     * though the DB still reports ADMITTED. May be null in no-database tests.
     */
    private final com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation isolation;

    public SafetyLeakProviderDisabler(
            ProviderRollbackService rollbackService,
            AlertNotifier alertNotifier) {
        this(rollbackService, alertNotifier, null);
    }

    public SafetyLeakProviderDisabler(
            ProviderRollbackService rollbackService,
            AlertNotifier alertNotifier,
            com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation isolation) {
        this.rollbackService = Objects.requireNonNull(
                rollbackService, "rollbackService must not be null");
        this.alertNotifier = Objects.requireNonNull(alertNotifier, "alertNotifier must not be null");
        this.isolation = isolation;
    }

    /**
     * Durably disables the deployment. Called AFTER the blocked finalize
     * transaction committed, so a rollback failure degrades to a P0 alert
     * instead of rolling the terminal OUTPUT_BLOCKED state back (which would
     * requeue the item and repeat the provider outbound).
     */
    public void disableDeployment(String providerId) {
        try {
            ProviderRollbackService.RollbackResult result =
                    rollbackService.rollback(providerId, TRIGGER_SAFETY_LEAK, ACTOR_OPERATOR);
            log.warn("safety leak (R4 final output) durably disabled deployment (changed={})",
                    result.changed());
            alertNotifier.alert(AlertSeverity.P1, ALERT_CODE_DISABLED, ALERT_MESSAGE_DISABLED);
        } catch (RuntimeException failure) {
            // The durable write failed: isolate the exact deployment in this
            // process immediately so the next routing attempt has zero egress
            // — the provider must not stay "healthy" because a DB write broke.
            if (isolation != null) {
                isolation.isolate(providerId);
            }
            log.error("safety leak (R4 final output) durable disable failed;"
                    + " deployment locally isolated", failure);
            alertNotifier.alert(
                    AlertSeverity.P0, ALERT_CODE_DISABLE_FAILED, ALERT_MESSAGE_DISABLE_FAILED
                            + "; the deployment is locally isolated in this process"
                            + " until restart or manual repair");
        }
    }
}
