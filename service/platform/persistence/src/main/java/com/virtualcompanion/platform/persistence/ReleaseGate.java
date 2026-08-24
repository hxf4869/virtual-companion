package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-24-A versioned release gate. Live expansion (CANARY/BETA) is fail-closed
 * until Owner records eval_passed.
 */
public final class ReleaseGate {

    static final String SNAPSHOT_SQL =
            "SELECT out_stage, out_eval_passed, out_policy_version, "
                    + "out_canary_owner_user_id FROM vc.release_gate_snapshot()";

    public record Snapshot(
            String stage,
            boolean evalPassed,
            String policyVersion,
            Long canaryOwnerUserId) {
    }

    private final JdbcTemplate jdbc;

    public ReleaseGate(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public Snapshot snapshot() {
        return jdbc.query(
                SNAPSHOT_SQL,
                (rs, rowNum) -> new Snapshot(
                        rs.getString("out_stage"),
                        rs.getBoolean("out_eval_passed"),
                        rs.getString("out_policy_version"),
                        rs.getObject("out_canary_owner_user_id", Long.class)))
                .stream().findFirst().orElseThrow(() ->
                        new IllegalStateException("release_gate_snapshot returned no row"));
    }

    /**
     * CANARY admits exactly its bound internal owner; BETA admits every owner
     * that passed the remaining admission checks. Missing/stale bindings and
     * every SYNTHETIC or eval-failed snapshot deny by default.
     */
    public boolean allowsGenerationFor(long ownerUserId) {
        if (ownerUserId <= 0) {
            return false;
        }
        Snapshot snapshot = snapshot();
        if (!snapshot.evalPassed()) {
            return false;
        }
        return switch (snapshot.stage()) {
            case "CANARY" -> snapshot.canaryOwnerUserId() != null
                    && snapshot.canaryOwnerUserId() == ownerUserId;
            case "BETA" -> true;
            default -> false;
        };
    }
}
