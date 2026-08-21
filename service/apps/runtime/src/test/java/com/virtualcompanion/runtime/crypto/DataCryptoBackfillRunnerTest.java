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
 * CRYPTO-REST backfill: pages plaintext rows through the V71 helpers,
 * encrypts each body (the UPDATE argument carries the enc1: form), and stops
 * when a short page ends the scan.
 */
class DataCryptoBackfillRunnerTest {

    private static final String KEY = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";

    @Test
    @SuppressWarnings("unchecked")
    void encryptsLegacyBatchesAndStopsOnShortPage() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AtomicInteger page = new AtomicInteger();

        when(jdbc.query(contains("backfill_plain_message_batch"),
                any(RowMapper.class), any(), any())).thenAnswer(inv -> {
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
        when(jdbc.queryForObject(contains("backfill_encrypt_message_content"),
                eq(Boolean.class), any(), any(), any())).thenReturn(true);

        DataCryptoBackfillRunner runner =
                new DataCryptoBackfillRunner(jdbc, new RestFieldCipher(KEY));
        runner.run(null);

        ArgumentCaptor<String> sealed = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(jdbc).queryForObject(
                contains("backfill_encrypt_message_content"), eq(Boolean.class),
                eq(7L), eq(42L), sealed.capture());
        assertThat(sealed.getValue()).startsWith("enc1:");
        assertThat(page.get()).isEqualTo(1);
    }
}
