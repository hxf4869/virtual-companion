package com.virtualcompanion.runtime.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.RestFieldCipher;
import java.sql.ResultSet;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * S0-17-B checkpoint backfill: pages stale rows through the V78 helpers,
 * re-encrypts each body under the current enc2 write prefix, and stops when
 * a short page ends the scan.
 */
class DataCryptoBackfillRunnerTest {

    private static final String KEY = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";

    @Test
    @SuppressWarnings("unchecked")
    void reencryptsStaleBatchesAndStopsOnShortPage() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AtomicInteger page = new AtomicInteger();
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        when(jdbc.query(contains("backfill_stale_cipher_message_batch"),
                any(RowMapper.class), any(), any(), eq(cipher.currentPrefix()))).thenAnswer(inv -> {
                    int p = page.getAndIncrement();
                    if (p > 0) {
                        return List.of();
                    }
                    RowMapper<DataCryptoBackfillRunner.BackfillRow> mapper =
                            (RowMapper<DataCryptoBackfillRunner.BackfillRow>) inv.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_owner_user_id")).thenReturn(7L);
                    when(rs.getLong("out_id")).thenReturn(42L);
                    when(rs.getString("out_content")).thenReturn("legacy body");
                    return List.of(mapper.mapRow(rs, 0));
                });
        when(jdbc.queryForObject(contains("backfill_replace_message_cipher"),
                eq(Boolean.class), any(), any(), any(), eq(cipher.currentPrefix())))
                .thenReturn(true);
        when(jdbc.query(contains("backfill_stale_cipher_summary_batch"),
                any(RowMapper.class), any(), any(), eq(cipher.currentPrefix())))
                .thenReturn(List.of());
        when(jdbc.queryForObject(
                eq(ConversationSummaryCipherReadiness.READY_SQL),
                eq(Boolean.class), eq(cipher.currentPrefix())))
                .thenReturn(true);

        DataCryptoBackfillRunner runner = new DataCryptoBackfillRunner(jdbc, cipher);
        runner.run(null);

        ArgumentCaptor<String> sealed = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(jdbc).queryForObject(
                contains("backfill_replace_message_cipher"), eq(Boolean.class),
                eq(7L), eq(42L), sealed.capture(), eq(cipher.currentPrefix()));
        assertThat(sealed.getValue()).startsWith("enc2:default:1:");
        assertThat(cipher.decrypt(sealed.getValue())).isEqualTo("legacy body");
        assertThat(page.get()).isEqualTo(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void reencryptsLegacyConversationSummaryBeforeTheDatabaseWrite() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RestFieldCipher cipher = new RestFieldCipher(KEY);
        when(jdbc.query(contains("backfill_stale_cipher_message_batch"),
                any(RowMapper.class), any(), any(), eq(cipher.currentPrefix())))
                .thenReturn(List.of());
        when(jdbc.query(contains("backfill_stale_cipher_summary_batch"),
                any(RowMapper.class), any(), any(), eq(cipher.currentPrefix())))
                .thenAnswer(inv -> {
                    RowMapper<DataCryptoBackfillRunner.BackfillRow> mapper =
                            (RowMapper<DataCryptoBackfillRunner.BackfillRow>) inv.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_owner_user_id")).thenReturn(8L);
                    when(rs.getLong("out_id")).thenReturn(51L);
                    when(rs.getString("out_content")).thenReturn("legacy sensitive summary");
                    return List.of(mapper.mapRow(rs, 0));
                });
        when(jdbc.queryForObject(contains("backfill_replace_summary_cipher"),
                eq(Boolean.class), any(), any(), any(), eq(cipher.currentPrefix())))
                .thenReturn(true);
        when(jdbc.queryForObject(
                eq(ConversationSummaryCipherReadiness.READY_SQL),
                eq(Boolean.class), eq(cipher.currentPrefix())))
                .thenReturn(true);

        new DataCryptoBackfillRunner(jdbc, cipher).run(null);

        ArgumentCaptor<String> sealed = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(jdbc).queryForObject(
                contains("backfill_replace_summary_cipher"), eq(Boolean.class),
                eq(8L), eq(51L), sealed.capture(), eq(cipher.currentPrefix()));
        assertThat(sealed.getValue()).startsWith("enc2:default:1:");
        assertThat(sealed.getValue()).doesNotContain("legacy sensitive summary");
        assertThat(cipher.decrypt(sealed.getValue())).isEqualTo("legacy sensitive summary");
    }
}
