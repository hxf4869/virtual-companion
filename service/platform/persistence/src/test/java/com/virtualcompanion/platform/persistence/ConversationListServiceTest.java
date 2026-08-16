package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link ConversationListService} (CONV-HIST). Verifies the V30
 * {@code vc.list_conversations} call (exact SQL and parameter passthrough,
 * including null relationship/cursor/limit delegation to the SD defaults), the
 * row mapping (nullable preview), and the parameter guards. The real SQL
 * round-trip is carried by DB test 85.
 */
class ConversationListServiceTest {

    private static final String LIST_SQL =
            "SELECT out_id, out_relationship_id, out_created_at, "
                    + "out_last_message_role, out_last_message_preview "
                    + "FROM vc.list_conversations(?, ?, ?, ?)";

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ConversationListService service = new ConversationListService(jdbc);

    private static final Instant NOW = Instant.parse("2026-08-16T08:00:00Z");

    @Test
    void listConversationsCallsTheV30FunctionWithAllFourParameters() {
        when(jdbc.query(eq(LIST_SQL), any(RowMapper.class), eq(1L), eq(10L), eq(42L), eq(20)))
                .thenReturn(List.of());

        List<ConversationListRecord> records = service.listConversations(1L, 10L, 42L, 20);

        assertEquals(0, records.size());
        verify(jdbc).query(eq(LIST_SQL), any(RowMapper.class), eq(1L), eq(10L), eq(42L), eq(20));
    }

    @Test
    void listConversationsDelegatesNullParametersToTheSdDefaults() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(null), eq(null), eq(null)))
                .thenReturn(List.of());

        service.listConversations(1L, null, null, null);

        verify(jdbc).query(anyString(), any(RowMapper.class), eq(1L), eq(null), eq(null), eq(null));
    }

    @Test
    void listConversationsMapsRowsIncludingNullablePreview() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(null), eq(0L), eq(50)))
                .thenReturn(List.of(new ConversationListRecord(100L, 10L, NOW, null, null)));

        List<ConversationListRecord> records = service.listConversations(1L, null, 0L, 50);

        assertEquals(1, records.size());
        assertEquals(100L, records.get(0).id());
        assertEquals(10L, records.get(0).relationshipId());
        assertEquals(NOW, records.get(0).createdAt());
        assertNull(records.get(0).lastMessageRole());
        assertNull(records.get(0).lastMessagePreview());
    }

    @Test
    void listConversationsRejectsNonPositiveOwner() {
        assertThrows(IllegalArgumentException.class,
                () -> service.listConversations(0L, null, null, null));
    }

    @Test
    void listConversationsRejectsNonPositiveRelationshipFilter() {
        assertThrows(IllegalArgumentException.class,
                () -> service.listConversations(1L, 0L, null, null));
    }
}
