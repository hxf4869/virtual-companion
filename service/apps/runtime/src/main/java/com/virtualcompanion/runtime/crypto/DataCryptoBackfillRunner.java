package com.virtualcompanion.runtime.crypto;

import com.virtualcompanion.platform.persistence.RestFieldCipher;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * CRYPTO-REST / S0-17-B checkpoint backfill: re-encrypts stale message bodies
 * (plaintext, {@code enc1:}, or {@code enc2} under a previous key) through the
 * V78 SECURITY DEFINER helpers. The application holds the key; the database
 * never does. Opt-in via {@code virtual-companion.crypto.backfill-enabled=true}.
 * Idempotent — rows already under the current write prefix are skipped.
 * S0-32 also re-encrypts {@code conversation_summary.summary}.
 */
public class DataCryptoBackfillRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataCryptoBackfillRunner.class);

    private final JdbcTemplate authJdbcTemplate;
    private final RestFieldCipher cipher;

    public DataCryptoBackfillRunner(JdbcTemplate authJdbcTemplate, RestFieldCipher cipher) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.cipher = cipher;
    }

    @Override
    public void run(ApplicationArguments args) {
        long messages = backfill(
                "vc.backfill_stale_cipher_message_batch",
                "vc.backfill_replace_message_cipher");
        long summaries = backfill(
                "vc.backfill_stale_cipher_summary_batch",
                "vc.backfill_replace_summary_cipher");
        Boolean ready = authJdbcTemplate.queryForObject(
                ConversationSummaryCipherReadiness.READY_SQL,
                Boolean.class,
                cipher.currentPrefix());
        if (!Boolean.TRUE.equals(ready)) {
            throw new IllegalStateException(
                    "conversation summary cipher backfill did not converge");
        }
        log.info("crypto backfill complete: {} stale message bodies and {} summaries re-encrypted",
                messages, summaries);
    }

    private long backfill(String batchFunction, String replaceFunction) {
        long lastId = 0L;
        long total = 0L;
        while (true) {
            List<BackfillRow> batch = authJdbcTemplate.query(
                    "SELECT out_owner_user_id, out_id, out_content "
                            + "FROM " + batchFunction + "(?, ?, ?)",
                    (rs, rowNum) -> new BackfillRow(
                            rs.getLong("out_owner_user_id"),
                            rs.getLong("out_id"),
                            rs.getString("out_content")),
                    lastId,
                    500,
                    cipher.currentPrefix());
            if (batch.isEmpty()) {
                break;
            }
            int converted = 0;
            for (BackfillRow row : batch) {
                String sealed = cipher.reencrypt(row.content());
                Boolean updated = authJdbcTemplate.queryForObject(
                        "SELECT " + replaceFunction + "(?, ?, ?, ?)",
                        Boolean.class,
                        row.ownerUserId(),
                        row.id(),
                        sealed,
                        cipher.currentPrefix());
                if (Boolean.TRUE.equals(updated)) {
                    converted++;
                }
                lastId = row.id();
            }
            total += converted;
            log.info("crypto backfill: {} encrypted {} of {} scanned rows (through id {})",
                    batchFunction, converted, batch.size(), lastId);
            if (batch.size() < 500) {
                break;
            }
        }
        return total;
    }

    record BackfillRow(long ownerUserId, long id, String content) {
    }
}
