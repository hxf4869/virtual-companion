package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link GenerationStateService#readSnapshot} (USAGE-VIZ).
 * Verifies the V8 function call, the follow-up settled-usage query on
 * {@code vc.generation_usage} (exact SQL + owner/generation passthrough), the
 * usage row mapping, and the parameter guards. The real SQL round-trip is
 * carried by the RLS test suite.
 */
class GenerationStateServiceTest {

    private static final String SNAPSHOT_SQL =
            "SELECT out_status, out_assistant_message_id, out_events "
                    + "FROM vc.read_generation_snapshot(?, ?)";
    private static final String USAGE_SQL =
            "SELECT input_tokens, output_tokens FROM vc.generation_usage "
                    + "WHERE owner_user_id = ? AND generation_id = ? "
                    + "ORDER BY id DESC LIMIT 1";

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GenerationStateService service = new GenerationStateService(jdbc);

    @Test
    void readSnapshotAttachesTheSettledUsageRow() {
        when(jdbc.queryForObject(eq(SNAPSHOT_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(new GenerationStateService.GenerationSnapshot(
                        "COMPLETED", 300L, "[]", null, null));
        when(jdbc.query(eq(USAGE_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(new GenerationStateService.GenerationSnapshot(
                        "COMPLETED", 300L, "[]", 42L, 58L)));

        GenerationStateService.GenerationSnapshot snapshot = service.readSnapshot(1L, 55L);

        assertEquals("COMPLETED", snapshot.status());
        assertEquals(300L, snapshot.assistantMessageId());
        assertEquals(42L, snapshot.inputTokens());
        assertEquals(58L, snapshot.outputTokens());
        verify(jdbc).queryForObject(eq(SNAPSHOT_SQL), any(RowMapper.class), eq(1L), eq(55L));
        verify(jdbc).query(eq(USAGE_SQL), any(RowMapper.class), eq(1L), eq(55L));
    }

    @Test
    void readSnapshotLeavesUsageNullBeforeFinalizeSettlesIt() {
        when(jdbc.queryForObject(eq(SNAPSHOT_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(new GenerationStateService.GenerationSnapshot(
                        "IN_PROGRESS", null, "[]", null, null));
        when(jdbc.query(eq(USAGE_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of());

        GenerationStateService.GenerationSnapshot snapshot = service.readSnapshot(1L, 55L);

        assertEquals("IN_PROGRESS", snapshot.status());
        assertNull(snapshot.inputTokens());
        assertNull(snapshot.outputTokens());
    }

    @Test
    void readSnapshotRejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class, () -> service.readSnapshot(0L, 55L));
        assertThrows(IllegalArgumentException.class, () -> service.readSnapshot(1L, 0L));
    }
}
