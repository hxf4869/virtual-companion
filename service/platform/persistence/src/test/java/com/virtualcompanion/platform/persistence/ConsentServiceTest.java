package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
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
 * Unit tests for {@link ConsentService} (CONSENT / V41): eager consent-type
 * and version validation, the SD call shapes, and the effective-state mapping.
 */
class ConsentServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ConsentService service = new ConsentService(jdbc);

    @Test
    void normalizeConsentTypeKeepsTheCatalogueAndRejectsOthers() {
        assertEquals("MODEL_TRAINING", ConsentService.normalizeConsentType("MODEL_TRAINING"));
        assertEquals("PRIVACY_POLICY", ConsentService.normalizeConsentType("PRIVACY_POLICY"));
        assertThrows(IllegalArgumentException.class,
                () -> ConsentService.normalizeConsentType(null));
        assertThrows(IllegalArgumentException.class,
                () -> ConsentService.normalizeConsentType("FACE_DATA"));
    }

    @Test
    void recordRejectsBlankOrOverlongVersion() {
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, "SERVICE_TERMS", "  ", true));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, "SERVICE_TERMS", "v".repeat(65), true));
    }

    @Test
    void recordCallsTheSdFunctionAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_consent(?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("SERVICE_TERMS"),
                eq("2026-08"),
                eq(true)))
                .thenReturn(77L);

        long id = service.record(1L, "SERVICE_TERMS", " 2026-08 ", true);

        assertEquals(77L, id);
    }

    // ---- AUTH-RECHECK (V46, FR-AUTH-005): revocation withdraws snapshots ----

    @Test
    void revokeAlsoWithdrawsEveryActiveSnapshotInTheSameTransaction() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_consent(?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("MODEL_TRAINING"),
                eq("2026-08"),
                eq(false)))
                .thenReturn(78L);
        when(jdbc.queryForObject(
                eq("SELECT vc.withdraw_authorization_snapshots(?)"),
                eq(Integer.class),
                eq(1L)))
                .thenReturn(3);

        long id = service.record(1L, "MODEL_TRAINING", "2026-08", false);

        assertEquals(78L, id);
        org.mockito.Mockito.verify(jdbc).queryForObject(
                eq("SELECT vc.withdraw_authorization_snapshots(?)"),
                eq(Integer.class),
                eq(1L));
    }

    @Test
    void grantDoesNotWithdrawSnapshots() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_consent(?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("MODEL_TRAINING"),
                eq("2026-08"),
                eq(true)))
                .thenReturn(79L);

        service.record(1L, "MODEL_TRAINING", "2026-08", true);

        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.never()).queryForObject(
                eq("SELECT vc.withdraw_authorization_snapshots(?)"),
                eq(Integer.class),
                eq(1L));
    }

    @Test
    void revokeFailsClosedWhenTheWithdrawalReturnsNoCount() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_consent(?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("MODEL_TRAINING"),
                eq("2026-08"),
                eq(false)))
                .thenReturn(80L);
        when(jdbc.queryForObject(
                eq("SELECT vc.withdraw_authorization_snapshots(?)"),
                eq(Integer.class),
                eq(1L)))
                .thenReturn(null);

        assertThrows(IllegalStateException.class,
                () -> service.record(1L, "MODEL_TRAINING", "2026-08", false));
    }

    @Test
    void listMapsTheEffectiveLatestRows() {
        when(jdbc.query(
                any(String.class),
                any(RowMapper.class),
                eq(1L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(78L);
                    when(rs.getString("out_consent_type")).thenReturn("MODEL_TRAINING");
                    when(rs.getString("out_version")).thenReturn("2026-08");
                    when(rs.getBoolean("out_granted")).thenReturn(false);
                    when(rs.getTimestamp("out_granted_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_revoked_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<ConsentRecord> records = service.list(1L);

        assertEquals(1, records.size());
        ConsentRecord record = records.get(0);
        assertEquals("MODEL_TRAINING", record.consentType());
        assertEquals(false, record.granted());
        assertEquals(NOW, record.revokedAt());
    }

    @Test
    void findLatestByTypeFiltersTheEffectiveState() {
        when(jdbc.query(
                any(String.class),
                any(RowMapper.class),
                eq(1L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(78L);
                    when(rs.getString("out_consent_type")).thenReturn("PRIVACY_POLICY");
                    when(rs.getString("out_version")).thenReturn("v2");
                    when(rs.getBoolean("out_granted")).thenReturn(true);
                    when(rs.getTimestamp("out_granted_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_revoked_at")).thenReturn(null);
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        assertTrue(service.findLatestByType(1L, "PRIVACY_POLICY").isPresent());
        assertTrue(service.findLatestByType(1L, "MODEL_TRAINING").isEmpty());
    }
}
