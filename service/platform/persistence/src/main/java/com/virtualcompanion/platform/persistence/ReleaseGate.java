package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-24-A versioned release gate. Live expansion (CANARY/BETA) is fail-closed
 * until Owner records eval_passed.
 */
public final class ReleaseGate {

    static final String SNAPSHOT_SQL =
            "SELECT out_stage, out_eval_passed, out_policy_version FROM vc.release_gate_snapshot()";

    public record Snapshot(String stage, boolean evalPassed, String policyVersion) {
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
                        rs.getString("out_policy_version")))
                .stream().findFirst().orElseThrow(() ->
                        new IllegalStateException("release_gate_snapshot returned no row"));
    }

    /** CANARY/BETA with eval_passed only. SYNTHETIC never expands live traffic. */
    public boolean allowsLiveExpansion() {
        Snapshot snapshot = snapshot();
        return snapshot.evalPassed()
                && ("CANARY".equals(snapshot.stage()) || "BETA".equals(snapshot.stage()));
    }
}
