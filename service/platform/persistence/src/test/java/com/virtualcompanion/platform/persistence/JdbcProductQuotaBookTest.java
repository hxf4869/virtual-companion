package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.routing.QuotaReservation;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * S0-11-C: durable product-quota SQL binding. Empty reserve is fail-closed;
 * settle/release pin the SD function names.
 */
class JdbcProductQuotaBookTest {

    @Test
    void reserveWithoutGenerationFailsClosed() {
        JdbcProductQuotaBook book = new JdbcProductQuotaBook(mock(JdbcTemplate.class), 10);
        assertThrows(IllegalStateException.class, () -> book.reserve("1", 1L));
    }

    @Test
    void emptyReserveResultIsNotAdmitted() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(10L), eq(1L), eq(5L)))
                .thenReturn(List.of());
        JdbcProductQuotaBook book = new JdbcProductQuotaBook(jdbc, 5);

        assertTrue(book.reserve("1", "10", 1L).isEmpty());
        verify(jdbc).query(
                eq(JdbcProductQuotaBook.RESERVE_SQL),
                any(RowMapper.class),
                eq(1L), eq(10L), eq(1L), eq(5L));
    }

    @Test
    void reserveMapsRemainingAndReservationId() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(10L), eq(1L), eq(5L)))
                .thenReturn(List.of(new QuotaReservation("qr-1", "1", 1L, 4L)));
        JdbcProductQuotaBook book = new JdbcProductQuotaBook(jdbc, 5);

        Optional<QuotaReservation> reserved = book.reserve("1", "10", 1L);
        assertTrue(reserved.isPresent());
        assertEquals("qr-1", reserved.orElseThrow().reservationId());
        assertEquals(4L, reserved.orElseThrow().remainingUnits());
    }

    @Test
    void releaseAndSettlePinFunctionNames() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        JdbcProductQuotaBook book = new JdbcProductQuotaBook(jdbc, 5);
        QuotaReservation reservation = new QuotaReservation("qr-1", "1", 1L, 4L);
        when(jdbc.queryForObject(eq(JdbcProductQuotaBook.RELEASE_SQL), eq(Long.class), eq(1L), eq("qr-1")))
                .thenReturn(5L);
        when(jdbc.queryForObject(eq(JdbcProductQuotaBook.SETTLE_SQL), eq(Boolean.class), eq(1L), eq("qr-1")))
                .thenReturn(true);

        assertEquals(5L, book.release(reservation));
        book.settle(reservation);
        verify(jdbc).queryForObject(JdbcProductQuotaBook.RELEASE_SQL, Long.class, 1L, "qr-1");
        verify(jdbc).queryForObject(JdbcProductQuotaBook.SETTLE_SQL, Boolean.class, 1L, "qr-1");
    }
}
