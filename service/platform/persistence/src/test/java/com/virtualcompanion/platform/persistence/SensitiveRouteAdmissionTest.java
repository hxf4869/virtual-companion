package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class SensitiveRouteAdmissionTest {

    @Test
    void pinsAdmitSqlAndMapsDecision() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(7L), eq("GENERATION"), eq(20), eq(60)))
                .thenReturn(List.of(new SensitiveRouteAdmission.Decision(true, 60)));
        SensitiveRouteAdmission admission = new SensitiveRouteAdmission(jdbc);

        SensitiveRouteAdmission.Decision decision = admission.admit(7L, "GENERATION", 20, 60);

        assertTrue(decision.admitted());
        assertEquals(60, decision.retryAfterSeconds());
        verify(jdbc).query(
                eq(SensitiveRouteAdmission.ADMIT_SQL),
                any(RowMapper.class),
                eq(7L), eq("GENERATION"), eq(20), eq(60));
    }

    @Test
    void mapsRejectedDecision() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(7L), eq("EXPORT"), eq(5), eq(3600)))
                .thenReturn(List.of(new SensitiveRouteAdmission.Decision(false, 12)));
        SensitiveRouteAdmission admission = new SensitiveRouteAdmission(jdbc);

        SensitiveRouteAdmission.Decision decision = admission.admit(7L, "EXPORT", 5, 3600);
        assertFalse(decision.admitted());
        assertEquals(12, decision.retryAfterSeconds());
    }

    @Test
    void rejectsNonPositiveOwner() {
        SensitiveRouteAdmission admission = new SensitiveRouteAdmission(mock(JdbcTemplate.class));
        assertThrows(IllegalArgumentException.class,
                () -> admission.admit(0L, "GENERATION", 20, 60));
    }
}
