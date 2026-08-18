package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Pure unit tests for the {@link GenerationRecord} value object, the
 * {@link GenerationReceiveService.ReceivedGeneration} result, and the eager
 * {@code validateReceive} argument checks.
 *
 * <p>The idempotent runtime behavior of {@code vc.receive_generation} (same
 * logical id on retry, no duplicate user message, composite-FK rejection of
 * cross-owner references) is proven by the SQL test suite under
 * {@code infra/db/tests}; this only pins the in-process invariants.
 */
class GenerationReceiveServiceTest {

    @Test
    void generationRecordKeepsFields() {
        GenerationRecord record = new GenerationRecord(7L, 101L, 9001L, "gen-abc", "CREATED", "key-1");
        assertEquals(7L, record.ownerUserId());
        assertEquals(101L, record.id());
        assertEquals(9001L, record.conversationId());
        assertEquals("gen-abc", record.logicalGenerationId());
        assertEquals("CREATED", record.status());
        assertEquals("key-1", record.idempotencyKey());
    }

    @Test
    void generationRecordAllowsNullIdempotencyKey() {
        GenerationRecord record = new GenerationRecord(7L, 101L, 9001L, "gen-abc", "CREATED", null);
        assertNull(record.idempotencyKey());
    }

    @Test
    void rejectsBlankLogicalGenerationIdOrStatus() {
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 101L, 9001L, "  ", "CREATED", null));
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 101L, 9001L, "gen-abc", "  ", null));
    }

    @Test
    void rejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(0L, 101L, 9001L, "gen-abc", "CREATED", null));
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 0L, 9001L, "gen-abc", "CREATED", null));
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 101L, 0L, "gen-abc", "CREATED", null));
    }

    @Test
    void rejectsBlankIdempotencyKey() {
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 101L, 9001L, "gen-abc", "CREATED", "  "));
    }

    @Test
    void receivedGenerationKeepsCreatedFields() {
        GenerationReceiveService.ReceivedGeneration first =
                new GenerationReceiveService.ReceivedGeneration("gen-abc", 101L, 202L, true);
        assertEquals("gen-abc", first.logicalGenerationId());
        assertEquals(101L, first.generationId());
        assertEquals(202L, first.messageId());
        assertEquals(true, first.created());
    }

    @Test
    void receivedGenerationAllowsNullMessageIdOnDuplicate() {
        GenerationReceiveService.ReceivedGeneration duplicate =
                new GenerationReceiveService.ReceivedGeneration("gen-abc", 101L, null, false);
        assertNull(duplicate.messageId());
        assertEquals(false, duplicate.created());
    }

    @Test
    void receivedGenerationRejectsBlankLogicalId() {
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationReceiveService.ReceivedGeneration("  ", 101L, 202L, true));
    }

    @Test
    void validateReceiveAcceptsValidArguments() {
        assertDoesNotThrow(() -> GenerationReceiveService.validateReceive(7L, 9001L, "user", "hi", "key-1"));
        assertDoesNotThrow(() -> GenerationReceiveService.validateReceive(7L, 9001L, "user", "", null));
    }

    @Test
    void validateReceiveRejectsNonPositiveOwnerOrConversation() {
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.validateReceive(0L, 9001L, "user", "hi", null));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.validateReceive(7L, 0L, "user", "hi", null));
    }

    @Test
    void validateReceiveRejectsBlankRoleOrNullContent() {
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.validateReceive(7L, 9001L, "  ", "hi", null));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.validateReceive(7L, 9001L, "user", null, null));
    }

    @Test
    void validateReceiveRejectsBlankIdempotencyKey() {
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.validateReceive(7L, 9001L, "user", "hi", "  "));
    }

    // ---- CHAT-MODE mode normalization ----

    @Test
    void generationRecordKeepsModeAndLegacyDefaultsToAuto() {
        GenerationRecord explicit = new GenerationRecord(
                7L, 101L, 9001L, "gen-abc", "CREATED", "key-1", "DISCUSS");
        assertEquals("DISCUSS", explicit.mode());
        GenerationRecord legacy = new GenerationRecord(7L, 101L, 9001L, "gen-abc", "CREATED", "key-1");
        assertEquals("AUTO", legacy.mode());
    }

    @Test
    void generationRecordRejectsBlankMode() {
        assertThrows(IllegalArgumentException.class,
                () -> new GenerationRecord(7L, 101L, 9001L, "gen-abc", "CREATED", null, "  "));
    }

    @Test
    void normalizeModeDefaultsBlankToAutoAndKeepsApprovedModes() {
        assertEquals("AUTO", GenerationReceiveService.normalizeMode(null));
        assertEquals("AUTO", GenerationReceiveService.normalizeMode("  "));
        assertEquals("AUTO", GenerationReceiveService.normalizeMode("AUTO"));
        assertEquals("LISTEN", GenerationReceiveService.normalizeMode("LISTEN"));
        assertEquals("DISCUSS", GenerationReceiveService.normalizeMode("DISCUSS"));
        assertEquals("CASUAL", GenerationReceiveService.normalizeMode("CASUAL"));
    }

    @Test
    void normalizeModeRejectsUnapprovedModes() {
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.normalizeMode("YELL"));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.normalizeMode("listen"));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationReceiveService.normalizeMode("DISCUSS; DROP TABLE x"));
    }
}
