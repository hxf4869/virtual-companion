package com.virtualcompanion.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * S0-32: conversation_summary is encrypted at the Java write boundary and
 * decrypted at the read boundary. SQL only sees enc2 ciphertext.
 */
class ConversationSummaryServiceTest {

    private static final String KEY = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";
    private static final Instant NOW = Instant.parse("2026-08-23T00:00:00Z");

    private final RestFieldCipher cipher = new RestFieldCipher(KEY);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ConversationSummaryService service =
            new ConversationSummaryService(jdbc, cipher);

    @Test
    void recordEncryptsPlaintextBeforeTheSdCall() {
        when(jdbc.queryForObject(
                contains("?::real"),
                eq(Long.class),
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(9L);

        Optional<Long> id = service.record(
                1L, 2L, 10L, 11L, "今晚心情不好",
                "deterministic-summarizer", "1", "1", 0.9, true, "ECONOMY");

        assertThat(id).contains(9L);
        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(
                contains("?::real"),
                eq(Long.class),
                eq(1L), eq(2L), eq(10L), eq(11L), stored.capture(),
                eq("deterministic-summarizer"), eq("1"), eq("1"),
                eq(0.9), eq(true), eq("ECONOMY"));
        assertThat(stored.getValue()).startsWith("enc2:default:1:");
        assertThat(stored.getValue()).doesNotContain("今晚心情不好");
        assertThat(cipher.decrypt(stored.getValue())).isEqualTo("今晚心情不好");
    }

    @Test
    @SuppressWarnings("unchecked")
    void latestDecryptsStoredCipherForTheApiBoundary() throws Exception {
        String sealed = cipher.encrypt("会话进展摘要");
        when(jdbc.query(contains("latest_conversation_summary"), any(RowMapper.class), eq(1L), eq(2L)))
                .thenAnswer(inv -> {
                    RowMapper<ConversationSummaryService.SummaryRecord> mapper =
                            (RowMapper<ConversationSummaryService.SummaryRecord>) inv.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(9L);
                    when(rs.getLong("out_from_message_id")).thenReturn(10L);
                    when(rs.getLong("out_to_message_id")).thenReturn(11L);
                    when(rs.getString("out_summary")).thenReturn(sealed);
                    when(rs.getString("out_model_id")).thenReturn("deterministic-summarizer");
                    when(rs.getString("out_model_version")).thenReturn("1");
                    when(rs.getString("out_prompt_version")).thenReturn("1");
                    when(rs.getDouble("out_confidence")).thenReturn(0.9);
                    when(rs.getBoolean("out_validated")).thenReturn(true);
                    when(rs.getString("out_service_class")).thenReturn("ECONOMY");
                    when(rs.getObject("out_prev_id")).thenReturn(null);
                    when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
                    return List.of(mapper.mapRow(rs, 0));
                });

        ConversationSummaryService.SummaryRecord row = service.latest(1L, 2L).orElseThrow();
        assertThat(row.summary()).isEqualTo("会话进展摘要");
        assertThat(row.summary()).doesNotStartWith("enc2:");
    }

    @Test
    @SuppressWarnings("unchecked")
    void recordTurnSummaryEncryptsBeforeTheOnlyDatabaseWrite() throws Exception {
        when(jdbc.query(
                contains("conversation_summary_turn_metadata"),
                any(RowMapper.class), eq(1L), eq(100L)))
                .thenAnswer(inv -> {
                    RowMapper<ConversationSummaryService.TurnMetadata> mapper =
                            (RowMapper<ConversationSummaryService.TurnMetadata>) inv.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_conversation_id")).thenReturn(2L);
                    when(rs.getLong("out_from_message_id")).thenReturn(10L);
                    when(rs.getLong("out_to_message_id")).thenReturn(11L);
                    when(rs.getLong("out_message_count")).thenReturn(2L);
                    when(rs.getString("out_service_class")).thenReturn("ECONOMY");
                    return List.of(mapper.mapRow(rs, 0));
                });
        when(jdbc.queryForObject(
                contains("?::real"),
                eq(Long.class),
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(9L);

        assertThat(service.recordTurnSummary(1L, 100L)).contains(9L);

        ArgumentCaptor<String> sealed = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(
                contains("?::real"),
                eq(Long.class),
                eq(1L), eq(2L), eq(10L), eq(11L), sealed.capture(),
                eq("deterministic-summarizer"), eq("1"), eq("1"),
                eq(1.0), eq(true), eq("ECONOMY"));
        assertThat(sealed.getValue()).startsWith("enc2:default:1:");
        assertThat(sealed.getValue()).doesNotContain("会话进展摘要");
        assertThat(cipher.decrypt(sealed.getValue()))
                .isEqualTo("会话进展摘要（确定性）：截至消息 11，本会话共 2 条消息。");
    }

    @Test
    void missingOrIncognitoTurnMetadataPerformsNoSummaryWrite() {
        when(jdbc.query(
                contains("conversation_summary_turn_metadata"),
                any(RowMapper.class), eq(1L), eq(100L)))
                .thenReturn(List.of());

        assertThat(service.recordTurnSummary(1L, 100L)).isEmpty();

        verify(jdbc).query(
                contains("conversation_summary_turn_metadata"),
                any(RowMapper.class), eq(1L), eq(100L));
        verifyNoMoreInteractions(jdbc);
    }
}
