package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link AgeVerificationService} (AGE-MIN / V45): the SD call
 * shapes and the effective-state mapping (never the identity document).
 */
class AgeVerificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AgeVerificationService service = new AgeVerificationService(jdbc);

    @Test
    void recordCallsTheSdAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_age_verification(?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("ADULT_VERIFIED"),
                eq("alpha-simulated")))
                .thenReturn(88L);

        assertEquals(88L, service.record(1L, "ADULT_VERIFIED", "alpha-simulated"));
    }

    @Test
    void recordRejectsBlankStateOrProvider() {
        assertThrows(IllegalArgumentException.class, () -> service.record(1L, " ", "x"));
        assertThrows(IllegalArgumentException.class, () -> service.record(1L, "ADULT_VERIFIED", " "));
    }

    @Test
    void getMapsTheLatestRow() {
        when(jdbc.query(
                anyString(),
                any(RowMapper.class),
                eq(1L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(88L);
                    when(rs.getString("out_age_state")).thenReturn("ADULT_VERIFIED");
                    when(rs.getString("out_provider_ref")).thenReturn("alpha-simulated");
                    when(rs.getTimestamp("out_verified_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        AgeVerificationRecord record = service.get(1L).orElseThrow();

        assertEquals("ADULT_VERIFIED", record.ageState());
        assertEquals("alpha-simulated", record.providerRef());
        assertEquals(NOW, record.verifiedAt());
    }

    @Test
    void getIsEmptyForANeverVerifiedOwner() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L))).thenReturn(List.of());

        assertTrue(service.get(1L).isEmpty());
    }
}
