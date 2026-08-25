package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
 * Unit tests for {@link ExportService} (DATA-EXPORT / V42): the eager
 * one-in-flight check, SD call shapes, the one-time consume mapping and the
 * expiry sweep.
 */
class ExportServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ExportService service = new ExportService(jdbc);

    @Test
    void createRejectsWhenAnExportIsAlreadyInFlight() {
        when(jdbc.queryForObject(
                eq("SELECT vc.count_inflight_exports(?)"), eq(Integer.class), eq(1L)))
                .thenReturn(1);

        assertThrows(IllegalArgumentException.class, () -> service.create(1L, "tok-1"));
    }

    @Test
    void createCallsTheSdAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.count_inflight_exports(?)"), eq(Integer.class), eq(1L)))
                .thenReturn(0);
        when(jdbc.queryForObject(
                eq("SELECT vc.create_export_request(?, ?)"), eq(Long.class), eq(1L), eq("tok-1")))
                .thenReturn(9L);

        assertEquals(9L, service.create(1L, "tok-1"));
    }

    @Test
    void getMapsTheStatusRow() {
        when(jdbc.query(
                any(String.class),
                any(RowMapper.class),
                eq(1L),
                eq(9L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(9L);
                    when(rs.getString("out_status")).thenReturn("READY");
                    when(rs.getTimestamp("out_requested_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_completed_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_expires_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getString("out_error_message")).thenReturn(null);
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        ExportRecord record = service.get(1L, 9L).orElseThrow();

        assertEquals(9L, record.id());
        assertEquals("READY", record.status());
        assertEquals(NOW, record.expiresAt());
    }

    @Test
    void getIsEmptyForAForeignOrAbsentExport() {
        when(jdbc.query(any(String.class), any(RowMapper.class), eq(1L), eq(9L)))
                .thenReturn(List.of());

        assertTrue(service.get(1L, 9L).isEmpty());
    }

    @Test
    void completeSealsOnlyWhenExactlyOneRowMoves() {
        when(jdbc.queryForObject(
                eq("SELECT vc.complete_export(?, ?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                eq("{\"ok\":true}"),
                eq(Timestamp.from(NOW))))
                .thenReturn(1);
        assertTrue(service.complete(1L, 9L, "{\"ok\":true}", NOW));

        when(jdbc.queryForObject(
                eq("SELECT vc.complete_export(?, ?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                eq("{\"ok\":true}"),
                eq(Timestamp.from(NOW))))
                .thenReturn(0);
        assertFalse(service.complete(1L, 9L, "{\"ok\":true}", NOW));
    }

    @Test
    void cipherEncryptsTheSealedPayloadAndDecryptsOnConsume() {
        RestFieldCipher cipher = new RestFieldCipher(
                java.util.Base64.getEncoder().encodeToString(new byte[32]));
        ExportService encrypted = new ExportService(jdbc, cipher);
        java.util.concurrent.atomic.AtomicReference<String> stored =
                new java.util.concurrent.atomic.AtomicReference<>();

        when(jdbc.queryForObject(
                eq("SELECT vc.complete_export(?, ?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                any(),
                eq(Timestamp.from(NOW))))
                .thenAnswer(invocation -> {
                    // args: (sql, type, owner, exportId, payload, expiresAt)
                    stored.set(invocation.getArgument(4));
                    return 1;
                });
        assertTrue(encrypted.complete(1L, 9L, "{\"ok\":true}", NOW));

        // At rest: opaque ciphertext, never the export document itself.
        assertTrue(stored.get().startsWith("enc2:"));
        assertFalse(stored.get().contains("{\"ok\":true}"));

        when(jdbc.query(
                eq("SELECT out_payload, out_object_key, out_object_bytes, "
                                + "out_expires_at FROM vc.consume_export(?, ?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(9L),
                eq("tok-1")))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getString("out_payload")).thenReturn(stored.get());
                    when(rs.getTimestamp("out_expires_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        assertEquals("{\"ok\":true}", encrypted.consume(1L, 9L, "tok-1").orElseThrow().payload());
    }

    @Test
    void failMovesOnlyThePendingRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.fail_export(?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                eq("boom")))
                .thenReturn(1);
        assertTrue(service.fail(1L, 9L, "boom"));
    }

    @Test
    void consumeReturnsThePayloadExactlyOnceAndIsEmptyOnSecondCall() {
        when(jdbc.query(
                eq("SELECT out_payload, out_object_key, out_object_bytes, "
                                + "out_expires_at FROM vc.consume_export(?, ?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(9L),
                eq("tok-1")))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getString("out_payload")).thenReturn("{\"exportId\":\"9\"}");
                    when(rs.getTimestamp("out_expires_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                })
                .thenReturn(List.of());

        ExportService.ExportDownload first =
                service.consume(1L, 9L, "tok-1").orElseThrow();
        assertEquals("{\"exportId\":\"9\"}", first.payload());
        assertEquals(NOW, first.expiresAt());

        assertTrue(service.consume(1L, 9L, "tok-1").isEmpty());
    }

    @Test
    void consumeRejectsABlankToken() {
        assertThrows(IllegalArgumentException.class, () -> service.consume(1L, 9L, "  "));
    }

    @Test
    void expireStaleRunsTheSweep() {
        when(jdbc.queryForObject(eq("SELECT vc.expire_stale_exports()"), eq(Integer.class)))
                .thenReturn(3);

        assertEquals(3, service.expireStale());
    }

    @Test
    void completeObjectSealsWithThePointerAndNullPayload() {
        when(jdbc.queryForObject(
                eq("SELECT vc.complete_export(?, ?, NULL::text, ?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                eq(Timestamp.from(NOW)),
                eq("exports/1/9.json"),
                eq(1024L)))
                .thenReturn(1);

        assertTrue(service.completeObject(
                1L, 9L, "exports/1/9.json", 1024L, NOW));
    }

    @Test
    void completeObjectRejectsABlankKeyOrNegativeBytes() {
        assertThrows(IllegalArgumentException.class,
                () -> service.completeObject(1L, 9L, " ", 10L, NOW));
        assertThrows(IllegalArgumentException.class,
                () -> service.completeObject(1L, 9L, "exports/1/9.json", -1L, NOW));
    }

    @Test
    void consumeMapsTheObjectPointerInObjectMode() {
        when(jdbc.query(
                eq("SELECT out_payload, out_object_key, out_object_bytes, "
                        + "out_expires_at FROM vc.consume_export(?, ?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(9L),
                eq("tok-1")))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getString("out_payload")).thenReturn(null);
                    when(rs.getString("out_object_key")).thenReturn("exports/1/9.json");
                    when(rs.getObject("out_object_bytes")).thenReturn(2048L);
                    when(rs.getLong("out_object_bytes")).thenReturn(2048L);
                    when(rs.getTimestamp("out_expires_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        ExportService.ExportDownload download =
                service.consume(1L, 9L, "tok-1").orElseThrow();
        assertEquals("exports/1/9.json", download.objectKey());
        assertEquals(2048L, download.objectBytes());
        assertEquals(NOW, download.expiresAt());
    }

    @Test
    void listExpiredObjectsMapsTheSweepWorklist() {
        when(jdbc.query(
                eq("SELECT out_owner_user_id, out_id, out_object_key "
                        + "FROM vc.list_expired_export_objects()"),
                any(RowMapper.class)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_owner_user_id")).thenReturn(1L);
                    when(rs.getLong("out_id")).thenReturn(9L);
                    when(rs.getString("out_object_key")).thenReturn("exports/1/9.json");
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        java.util.List<ExportService.ExpiredExportObject> stale =
                service.listExpiredObjects();
        assertEquals(1, stale.size());
        assertEquals(new ExportService.ExpiredExportObject(1L, 9L, "exports/1/9.json"),
                stale.getFirst());
    }

    @Test
    void clearObjectRunsTheCasUpdate() {
        when(jdbc.queryForObject(
                eq("SELECT vc.clear_export_object(?, ?, ?)"),
                eq(Integer.class),
                eq(1L),
                eq(9L),
                eq("exports/1/9.json")))
                .thenReturn(1);

        assertTrue(service.clearObject(1L, 9L, "exports/1/9.json"));
    }
}
