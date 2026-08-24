package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class ProviderRollbackServiceTest {

    private static final Instant ROLLED_BACK_AT = Instant.parse("2026-08-24T08:30:00Z");

    @Test
    void rollbackPinsSecurityDefinerWritePathAndMapsResult() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(
                        any(String.class),
                        any(RowMapper.class),
                        eq("provider-a"),
                        eq("CONSECUTIVE_FAILURES"),
                        eq("AUTO")))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_history_id")).thenReturn(17L);
                    when(rs.getString("out_previous_admission_state")).thenReturn("ADMITTED");
                    when(rs.getBoolean("out_changed")).thenReturn(true);
                    when(rs.getTimestamp("out_rolled_back_at"))
                            .thenReturn(Timestamp.from(ROLLED_BACK_AT));
                    RowMapper<ProviderRollbackService.RollbackResult> mapper =
                            invocation.getArgument(1);
                    return List.of(mapper.mapRow(rs, 0));
                });
        ProviderRollbackService service = new ProviderRollbackService(jdbc);

        ProviderRollbackService.RollbackResult result = service.rollback(
                " provider-a ", "CONSECUTIVE_FAILURES", "AUTO");

        assertEquals(17L, result.historyId());
        assertEquals("ADMITTED", result.previousAdmissionState());
        assertTrue(result.changed());
        assertEquals(ROLLED_BACK_AT, result.rolledBackAt());
        verify(jdbc).query(
                eq(ProviderRollbackService.ROLLBACK_SQL),
                any(RowMapper.class),
                eq("provider-a"),
                eq("CONSECUTIVE_FAILURES"),
                eq("AUTO"));
        assertFalse(ProviderRollbackService.ROLLBACK_SQL.contains("UPDATE"));
        assertFalse(ProviderRollbackService.ROLLBACK_SQL.contains("INSERT"));
    }

    @Test
    void rollbackMapsAlreadyDisabledHistory() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProviderRollbackService.RollbackResult expected =
                new ProviderRollbackService.RollbackResult(
                        18L, "DISABLED", false, ROLLED_BACK_AT);
        when(jdbc.query(
                        any(String.class),
                        any(RowMapper.class),
                        eq("provider-a"),
                        eq("OPERATOR"),
                        eq("OPERATOR")))
                .thenReturn(List.of(expected));
        ProviderRollbackService service = new ProviderRollbackService(jdbc);

        ProviderRollbackService.RollbackResult result =
                service.rollback("provider-a", "OPERATOR", "OPERATOR");

        assertFalse(result.changed());
        assertEquals("DISABLED", result.previousAdmissionState());
    }

    @Test
    void rejectsUnknownCodesBeforeDatabaseAccess() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProviderRollbackService service = new ProviderRollbackService(jdbc);

        assertThrows(IllegalArgumentException.class,
                () -> service.rollback("provider-a", "UNKNOWN", "AUTO"));
        assertThrows(IllegalArgumentException.class,
                () -> service.rollback("provider-a", "SAFETY_LEAK", "SYSTEM"));
        assertThrows(IllegalArgumentException.class,
                () -> service.rollback("provider-a", "SAFETY_LEAK", "AUTO"));
        assertThrows(IllegalArgumentException.class,
                () -> service.rollback("provider-a", "CONSECUTIVE_FAILURES", "OPERATOR"));
        assertThrows(IllegalArgumentException.class,
                () -> service.rollback(" ", "BILLING_DRIFT", "AUTO"));

        verifyNoInteractions(jdbc);
    }
}
