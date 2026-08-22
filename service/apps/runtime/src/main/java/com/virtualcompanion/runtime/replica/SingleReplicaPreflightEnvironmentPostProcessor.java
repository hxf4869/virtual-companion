package com.virtualcompanion.runtime.replica;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

/**
 * Single-replica hard gate for the Technical Alpha / Beta runtime (S0-33,
 * blueprint §12.7). Until shared Realtime / cancel / authorization / quota /
 * breaker / scheduler state is externalized (S2-37), every deployment must
 * declare exactly ONE runtime instance — a declared replica count other than
 * 1 means the deployment intends a multi-instance topology, which is
 * forbidden at every stage and in every profile.
 *
 * <p>Unlike {@code ProductionFailClosedEnvironmentPostProcessor}, this gate is
 * profile-independent: a second dev, smoke or production instance is equally
 * unsafe while the runtime state above is process-local. The property
 * {@code virtual-companion.runtime.replicas} ({@code VC_RUNTIME_REPLICAS})
 * defaults to {@code 1} (application.yaml), so an undeclared value is the
 * single-replica baseline; any explicit value other than {@code 1} refuses
 * startup with a deterministic message before any bean exists. There is no
 * remote feature flag, switch or opt-out: the gate is a hard invariant, which
 * is what makes it non-bypassable from a running deployment.
 *
 * <p>This gate covers the DECLARED replica count. The runtime additionally
 * enforces actual membership exclusivity with a PostgreSQL advisory-lock
 * lease in {@link SingletonLeaseDataSource} / {@link RuntimeSingletonLease},
 * so a scaled deployment (for example {@code docker compose up --scale
 * runtime=2}) is refused by the second instance even though no declaration
 * changed.
 */
public class SingleReplicaPreflightEnvironmentPostProcessor
        implements EnvironmentPostProcessor {

    /** Canonical property (application.yaml binds ${VC_RUNTIME_REPLICAS:1}). */
    public static final String REPLICAS_PROPERTY = "virtual-companion.runtime.replicas";

    @Override
    public void postProcessEnvironment(
            ConfigurableEnvironment environment, SpringApplication application) {
        String raw = environment.getProperty(REPLICAS_PROPERTY, "1");
        int replicas;
        try {
            replicas = Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            throw new IllegalStateException(
                    REPLICAS_PROPERTY + " (VC_RUNTIME_REPLICAS) must be an integer "
                            + "declaring the runtime replica count; got '" + raw + "' — this "
                            + "deployment WILL NOT START");
        }
        if (replicas != 1) {
            throw new IllegalStateException(
                    REPLICAS_PROPERTY + " (VC_RUNTIME_REPLICAS) declares " + replicas
                            + " runtime replica(s); exactly 1 is permitted until shared "
                            + "Realtime/cancel/quota/breaker state is externalized (S2-37) — "
                            + "this deployment WILL NOT START");
        }
    }
}