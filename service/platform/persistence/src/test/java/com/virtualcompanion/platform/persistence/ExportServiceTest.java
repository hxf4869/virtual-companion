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
                eq("SELECT out_payload, out_expires_at FROM vc.consume_export(?, ?, ?)"),
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
}
