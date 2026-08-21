package com.virtualcompanion.platform.persistence;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * B1-SURVEY (§26.5 / R45): 被理解感评分采集 over the V72 SDs. One immutable
 * daily score per owner (1..5); the Beta product gate (n≥200, average) is
 * computed offline from {@code vc.survey_response}, not here.
 */
public class SurveyService {

    private static final String RECORD_SQL =
            "SELECT vc.record_survey_response(?, ?, ?)";
    private static final String LIST_SQL =
            "SELECT out_date, out_score, out_created_at "
                    + "FROM vc.list_my_surveys(?, ?, ?)";

    private final JdbcTemplate jdbc;

    public SurveyService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Record today's score; false when the owner already scored today. */
    public boolean record(long ownerUserId, Long conversationId, int score) {
        Boolean inserted = jdbc.queryForObject(
                RECORD_SQL, Boolean.class, ownerUserId, conversationId, score);
        return Boolean.TRUE.equals(inserted);
    }

    /** The owner's own scoring history, newest first. */
    public List<SurveyRow> list(long ownerUserId, LocalDate after, int limit) {
        return jdbc.query(
                LIST_SQL,
                (rs, rowNum) -> new SurveyRow(
                        rs.getDate("out_date").toLocalDate(),
                        rs.getShort("out_score"),
                        rs.getTimestamp("out_created_at").toInstant()),
                ownerUserId,
                after == null ? null : Date.valueOf(after),
                limit);
    }

    /** B1-SURVEY: one own survey row. */
    public record SurveyRow(LocalDate date, short score, Instant createdAt) {
    }
}
