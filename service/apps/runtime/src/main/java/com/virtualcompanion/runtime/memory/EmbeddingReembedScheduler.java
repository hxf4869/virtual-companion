package com.virtualcompanion.runtime.memory;

import com.virtualcompanion.platform.persistence.EmbeddingReembedService;
import com.virtualcompanion.platform.persistence.RestFieldCipher;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * S0-09 resumable re-embed runner. Batch rows contain only ids plus the existing
 * stored (encrypted) summary; decryption and provider transfer happen in memory.
 * Per-item failures advance the checkpoint and produce COMPLETED_WITH_FAILURES,
 * so one bad row cannot block unrelated memories and old-space retirement stays
 * forbidden until a clean pass completes.
 */
public final class EmbeddingReembedScheduler {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingReembedScheduler.class);

    private final EmbeddingReembedService service;
    private final EmbeddingPort embeddingPort;
    private final RestFieldCipher cipher;
    private final String sourceSpaceId;
    private final int batchSize;

    public EmbeddingReembedScheduler(
            EmbeddingReembedService service,
            EmbeddingPort embeddingPort,
            RestFieldCipher cipher,
            String sourceSpaceId,
            int batchSize) {
        this.service = Objects.requireNonNull(service, "service must not be null");
        this.embeddingPort = Objects.requireNonNull(embeddingPort, "embeddingPort must not be null");
        this.cipher = Objects.requireNonNull(cipher, "cipher must not be null");
        this.sourceSpaceId = requireText(sourceSpaceId, "sourceSpaceId");
        if (batchSize <= 0 || batchSize > 100) {
            throw new IllegalArgumentException("batchSize must be within 1..100");
        }
        if (this.sourceSpaceId.equals(embeddingPort.space().spaceId())) {
            throw new IllegalArgumentException("source and target embedding spaces must differ");
        }
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${virtual-companion.embedding.reembed-drain-ms:30000}")
    public void drain() {
        EmbeddingPort.EmbeddingSpace target = embeddingPort.space();
        int succeeded = 0;
        int failed = 0;
        try {
            service.ensure(
                    target.spaceId(), sourceSpaceId, target.modelId(),
                    target.modelVersion(), target.dimension(), true);
            for (EmbeddingReembedService.Claimed item : service.claim(target.spaceId(), batchSize)) {
                try {
                    String summary = cipher.decrypt(item.storedSummary());
                    float[] vector = embeddingPort.embed(item.ownerUserId(), summary);
                    boolean completed = service.completeSuccess(
                            target.spaceId(), item.ownerUserId(), item.memoryItemId(),
                            DeterministicEmbedder.toVectorLiteral(vector));
                    if (completed) {
                        succeeded++;
                    } else {
                        failed++;
                    }
                } catch (RuntimeException itemFailure) {
                    failed++;
                    try {
                        service.completeFailure(
                                target.spaceId(), item.ownerUserId(), item.memoryItemId());
                    } catch (RuntimeException checkpointFailure) {
                        log.warn("embedding re-embed checkpoint update failed");
                        return;
                    }
                }
            }
            if (succeeded > 0 || failed > 0) {
                log.info("embedding re-embed batch finished succeeded={} failed={}", succeeded, failed);
            }
        } catch (RuntimeException jobFailure) {
            log.warn("embedding re-embed drain failed");
        }
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return normalized;
    }
}
