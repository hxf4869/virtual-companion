package com.virtualcompanion.modelruntime.registry;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * DOGFOOD-STABILIZATION audit (ADR-0006 §3.4): process-local emergency
 * isolation for one exact provider deployment.
 *
 * <p>When a safety-leak durable rollback (DB {@code DISABLED}) itself fails,
 * the database still reports the deployment ADMITTED; the runtime must not
 * keep routing to it. Isolating the providerId here makes the very next
 * routing attempt see no eligible deployment — zero egress — until the
 * process restarts or the Owner repairs the durable state. The set is
 * deliberately one-way within a process lifetime: recovery is a manual
 * owner decision, never an automatic un-isolate.</p>
 */
public final class LocalDeploymentIsolation {

    private final Set<String> isolated = ConcurrentHashMap.newKeySet();

    /** One-way within this process: an isolated deployment never re-enters routing. */
    public void isolate(String providerId) {
        if (providerId != null && !providerId.isBlank()) {
            isolated.add(providerId);
        }
    }

    public boolean isIsolated(String providerId) {
        return providerId != null && isolated.contains(providerId);
    }

    public int size() {
        return isolated.size();
    }
}
