package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link MessageHistoryService} (TASK-0179). Verifies the V10
 * {@code vc.list_messages} call (exact SQL and parameter passthrough, including
 * null cursor/limit delegation to the SD defaults), the row mapping, and the
 * parameter guards. The real SQL round-trip is carried by DB test 31.
 */
class MessageHistoryServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MessageHistoryService service = new MessageHistoryService(jdbc);

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");

    @Test
    void listMessagesCallsTheV10FunctionWithAllFourParameters() {
        when(jdbc.query(
                eq("SELECT out_id, out_role, out_content, out_created_at, out_no_memory "
                        + "FROM vc.list_messages(?, ?, ?, ?)"),
                any(RowMapper.class),
                eq(1L), eq(100L), eq(42L), eq(20)))
                .thenReturn(List.of());

        List<MessageHistoryRecord> records =
                service.listMessages(1L, 100L, 42L, 20);

        assertEquals(0, records.size());
        verify(jdbc).query(
                eq("SELECT out_id, out_role, out_content, out_created_at, out_no_memory "
                        + "FROM vc.list_messages(?, ?, ?, ?)"),
                any(RowMapper.class),
                eq(1L), eq(100L), eq(42L), eq(20));
    }

    @Test
    void listMessagesDelegatesNullCursorAndLimitToTheSdDefaults() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(100L), eq(null), eq(null)))
                .thenReturn(List.of());

        service.listMessages(1L, 100L, null, null);

        verify(jdbc).query(anyString(), any(RowMapper.class), eq(1L), eq(100L), eq(null), eq(null));
    }

    @Test
    void listMessagesMapsV10RowsToRecords() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong("out_id")).thenReturn(7L);
        when(rs.getString("out_role")).thenReturn("assistant");
        when(rs.getString("out_content")).thenReturn("hello");
        when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
        when(rs.getBoolean("out_no_memory")).thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(100L), eq(0L), eq(50)))
                .thenAnswer(invocation -> {
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<MessageHistoryRecord> records = service.listMessages(1L, 100L, 0L, 50);

        assertEquals(1, records.size());
        assertEquals(7L, records.get(0).id());
        assertEquals("assistant", records.get(0).role());
        assertEquals("hello", records.get(0).content());
        assertEquals(NOW, records.get(0).createdAt());
        assertEquals(true, records.get(0).noMemory());
    }

    @Test
    void listMessagesRejectsNonPositiveOwner() {
        assertThrows(IllegalArgumentException.class, () -> service.listMessages(0L, 100L, null, null));
    }

    @Test
    void listMessagesRejectsNonPositiveConversation() {
        assertThrows(IllegalArgumentException.class, () -> service.listMessages(1L, 0L, null, null));
    }
}
