package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * B1-SURVEY: the service delegates to the V72 SDs — record returns the
 * first-of-day verdict, list maps the owner's own rows.
 */
class SurveyServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void recordReturnsFirstOfDayVerdictAndListMapsRows() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SurveyService service = new SurveyService(jdbc);

        when(jdbc.queryForObject(contains("record_survey_response"),
                eq(Boolean.class), any(), any(), any())).thenReturn(true, false);

        assertTrue(service.record(7L, null, 4));
        assertFalse(service.record(7L, 12L, 5));

        when(jdbc.query(contains("list_my_surveys"), any(RowMapper.class),
                any(), any(), any())).thenAnswer(inv -> {
                    RowMapper<SurveyService.SurveyRow> mapper =
                            (RowMapper<SurveyService.SurveyRow>) inv.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getDate("out_date")).thenReturn(
                            java.sql.Date.valueOf("2026-08-21"));
                    when(rs.getShort("out_score")).thenReturn((short) 4);
                    when(rs.getTimestamp("out_created_at")).thenReturn(
                            Timestamp.from(Instant.parse("2026-08-21T12:00:00Z")));
                    return List.of(mapper.mapRow(rs, 0));
                });

        List<SurveyService.SurveyRow> rows = service.list(7L, null, 50);
        assertEquals(1, rows.size());
        assertEquals(LocalDate.of(2026, 8, 21), rows.get(0).date());
        assertEquals((short) 4, rows.get(0).score());
    }
}
