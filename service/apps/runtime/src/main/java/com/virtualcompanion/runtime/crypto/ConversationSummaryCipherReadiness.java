package com.virtualcompanion.runtime.crypto;

import com.virtualcompanion.platform.persistence.RestFieldCipher;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-32 production startup gate used when the opt-in crypto backfill is disabled. A
 * runtime must not serve while an effective conversation summary is plaintext,
 * enc1, or encrypted under a non-current key slot.
 */
public final class ConversationSummaryCipherReadiness implements ApplicationRunner {

    static final String READY_SQL = "SELECT vc.conversation_summary_cipher_ready(?)";

    private final JdbcTemplate jdbc;
    private final RestFieldCipher cipher;

    public ConversationSummaryCipherReadiness(JdbcTemplate jdbc, RestFieldCipher cipher) {
        this.jdbc = java.util.Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.cipher = java.util.Objects.requireNonNull(cipher, "cipher must not be null");
    }

    @Override
    public void run(ApplicationArguments args) {
        Boolean ready = jdbc.queryForObject(READY_SQL, Boolean.class, cipher.currentPrefix());
        if (!Boolean.TRUE.equals(ready)) {
            throw new IllegalStateException(
                    "conversation summary cipher backfill is required; "
                            + "start once with VC_CRYPTO_BACKFILL_ENABLED=true");
        }
    }
}
