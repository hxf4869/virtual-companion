package com.virtualcompanion.runtime.crypto;

import com.virtualcompanion.platform.persistence.RestFieldCipher;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * CRYPTO-REST one-shot backfill: encrypts legacy plaintext message bodies in
 * batches through the V71 SECURITY DEFINER helpers (the application holds the
 * key; the database never does). Opt-in via
 * {@code virtual-companion.crypto.backfill-enabled=true} for exactly one boot
 * after a deployment enables at-rest encryption; idempotent — already-encrypted
 * rows are skipped both by the scan and by the conditional update.
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
        long lastId = 0L;
        long total = 0L;
        while (true) {
            List<BackfillRow> batch = authJdbcTemplate.query(
                    "SELECT out_owner_user_id, out_id, out_content "
                            + "FROM vc.backfill_plain_message_batch(?, ?)",
                    (rs, rowNum) -> new BackfillRow(
                            rs.getLong("out_owner_user_id"),
                            rs.getLong("out_id"),
                            rs.getString("out_content")),
                    lastId,
                    500);
            if (batch.isEmpty()) {
                break;
            }
            int converted = 0;
            for (BackfillRow row : batch) {
                String sealed = cipher.encrypt(row.content());
                Boolean updated = authJdbcTemplate.queryForObject(
                        "SELECT vc.backfill_encrypt_message_content(?, ?, ?)",
                        Boolean.class,
                        row.ownerUserId(),
                        row.id(),
                        sealed);
                if (Boolean.TRUE.equals(updated)) {
                    converted++;
                }
                lastId = row.id();
            }
            total += converted;
            log.info("crypto backfill: encrypted {} of {} scanned rows (through id {})",
                    converted, batch.size(), lastId);
            if (batch.size() < 500) {
                break;
            }
        }
        log.info("crypto backfill complete: {} plaintext bodies encrypted", total);
    }

    record BackfillRow(long ownerUserId, long id, String content) {
    }
}
