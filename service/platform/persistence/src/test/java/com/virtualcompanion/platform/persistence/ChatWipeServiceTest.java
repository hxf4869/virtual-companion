package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.ChatWipeService.ChatWipePreview;
import com.virtualcompanion.platform.persistence.ChatWipeService.ChatWipeResult;
import java.sql.ResultSet;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link ChatWipeService} (CHAT-WIPE / V57): the SD call
 * shapes and the preview/result mapping.
 */
class ChatWipeServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ChatWipeService service = new ChatWipeService(jdbc);

    @Test
    @SuppressWarnings("unchecked")
    void previewCallsTheSdAndMapsTheCounts() {
        when(jdbc.queryForObject(
                org.mockito.ArgumentMatchers.eq(
                        "SELECT out_conversation_count, out_message_count, out_in_flight_count "
                                + "FROM vc.preview_chat_wipe(?)"),
                org.mockito.ArgumentMatchers.any(RowMapper.class),
                org.mockito.ArgumentMatchers.eq(1L)))
                .thenAnswer(invocation -> {
                    RowMapper<ChatWipePreview> mapper =
                            (RowMapper<ChatWipePreview>) invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_conversation_count")).thenReturn(2L);
                    when(rs.getLong("out_message_count")).thenReturn(34L);
                    when(rs.getLong("out_in_flight_count")).thenReturn(1L);
                    return mapper.mapRow(rs, 0);
                });

        ChatWipePreview preview = service.preview(1L);
        assertEquals(2L, preview.conversationCount());
        assertEquals(34L, preview.messageCount());
        assertEquals(1L, preview.inFlightCount());
    }

    @Test
    @SuppressWarnings("unchecked")
    void wipeAllCallsTheSdAndMapsTheResult() {
        when(jdbc.queryForObject(
                org.mockito.ArgumentMatchers.eq(
                        "SELECT out_conversations_deleted, out_messages_deleted, "
                                + "out_work_items_cancelled FROM vc.wipe_all_chats(?)"),
                org.mockito.ArgumentMatchers.any(RowMapper.class),
                org.mockito.ArgumentMatchers.eq(1L)))
                .thenAnswer(invocation -> {
                    RowMapper<ChatWipeResult> mapper =
                            (RowMapper<ChatWipeResult>) invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_conversations_deleted")).thenReturn(2L);
                    when(rs.getLong("out_messages_deleted")).thenReturn(34L);
                    when(rs.getLong("out_work_items_cancelled")).thenReturn(1L);
                    return mapper.mapRow(rs, 0);
                });

        ChatWipeResult result = service.wipeAll(1L);
        assertEquals(2L, result.conversationsDeleted());
        assertEquals(34L, result.messagesDeleted());
        assertEquals(1L, result.workItemsCancelled());
    }

    @Test
    void rejectsNonPositiveOwner() {
        assertThrows(IllegalArgumentException.class, () -> service.preview(0L));
        assertThrows(IllegalArgumentException.class, () -> service.wipeAll(0L));
    }
}
