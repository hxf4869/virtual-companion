package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Safety-event persistence over the V58 SD (SAFETY-WIRE, §20.10/§20.11).
 *
 * <p>Every deterministic block/pause appends one minimal row: the pipeline
 * stage (INPUT / INCREMENTAL / FINAL), the risk-levels catalog code and the
 * rule id. No content is ever stored (最小必要); rows deliberately have no FK
 * to vc.generation so they survive generation and conversation deletion.
 */
public class SafetyEventService {

    /** Pipeline stage codes (V58 CHECK). */
    public static final String STAGE_INPUT = "INPUT";
    public static final String STAGE_INCREMENTAL = "INCREMENTAL";
    public static final String STAGE_FINAL = "FINAL";

    private final JdbcTemplate jdbc;

    public SafetyEventService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Append one safety event; returns the new row id. */
    public long record(
            long ownerUserId, Long generationId, String stage,
            String riskLevel, String ruleId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (ruleId == null || ruleId.isBlank() || ruleId.length() > 100) {
            throw new IllegalArgumentException("ruleId must be 1..100 characters");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.record_safety_event(?, ?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                generationId,
                stage,
                riskLevel,
                ruleId);
        if (id == null || id <= 0) {
            throw new IllegalStateException("record_safety_event returned no id");
        }
        return id;
    }
}
