package com.virtualcompanion.runtime.crypto;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.RestFieldCipher;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ConversationSummaryCipherReadinessTest {

    private static final String KEY =
            "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";

    @Test
    void currentCipherRowsAllowStartup() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RestFieldCipher cipher = new RestFieldCipher(KEY);
        when(jdbc.queryForObject(
                ConversationSummaryCipherReadiness.READY_SQL,
                Boolean.class,
                cipher.currentPrefix())).thenReturn(true);

        assertThatCode(() -> new ConversationSummaryCipherReadiness(jdbc, cipher).run(null))
                .doesNotThrowAnyException();
    }

    @Test
    void staleEffectiveSummaryFailsClosedWithOperatorActionOnly() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RestFieldCipher cipher = new RestFieldCipher(KEY);
        when(jdbc.queryForObject(
                ConversationSummaryCipherReadiness.READY_SQL,
                Boolean.class,
                cipher.currentPrefix())).thenReturn(false);

        assertThatThrownBy(() -> new ConversationSummaryCipherReadiness(jdbc, cipher).run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("VC_CRYPTO_BACKFILL_ENABLED=true")
                .hasMessageNotContaining("summary body");
    }
}
