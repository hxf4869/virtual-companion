package com.virtualcompanion.runtime.memory;

import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import java.util.Objects;

/**
 * S0-09 fail-closed owner gate for external embeddings. Both third-party model
 * processing and sensitive-data processing must currently be granted before
 * any text can leave the runtime. The no-owner method is deliberately unusable
 * so a future caller cannot bypass consent accidentally.
 */
public final class ConsentGatedEmbeddingPort implements EmbeddingPort {

    private static final String THIRD_PARTY = "THIRD_PARTY_MODEL_PROCESSING";
    private static final String SENSITIVE = "SENSITIVE_DATA_PROCESSING";

    private final EmbeddingPort external;
    private final ConsentService consents;
    private final AccountDeletionIntentService deletionIntents;

    public ConsentGatedEmbeddingPort(EmbeddingPort external, ConsentService consents) {
        this(external, consents, null);
    }

    public ConsentGatedEmbeddingPort(
            EmbeddingPort external,
            ConsentService consents,
            AccountDeletionIntentService deletionIntents) {
        this.external = Objects.requireNonNull(external, "external must not be null");
        this.consents = Objects.requireNonNull(consents, "consents must not be null");
        this.deletionIntents = deletionIntents;
    }

    @Override
    public EmbeddingSpace space() {
        return external.space();
    }

    @Override
    public float[] embed(String text) {
        throw new IllegalStateException("external embedding requires an owner-bound consent check");
    }

    @Override
    public float[] embed(long ownerUserId, String text) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (deletionIntents != null && deletionIntents.activeCurrent(ownerUserId)) {
            throw new IllegalStateException("owner deletion blocks external embedding");
        }
        if (!granted(ownerUserId, THIRD_PARTY) || !granted(ownerUserId, SENSITIVE)) {
            throw new IllegalStateException("external embedding consent is not granted");
        }
        return external.embed(text);
    }

    private boolean granted(long ownerUserId, String type) {
        return consents.findLatestByType(ownerUserId, type)
                .map(ConsentRecord::granted)
                .orElse(false);
    }
}
