package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Pure unit tests for the {@link ResumeResult} and {@link StreamSnapshot} value
 * objects and the eager {@code validateResume}/{@code validateSnapshot} checks.
 *
 * <p>The resume disposition machine (RESUMED | TERMINAL_SNAPSHOT | GAP_EXPIRED |
 * RESET_REQUIRED | NOT_FOUND_OR_FORBIDDEN), epoch reset, gap window and RLS
 * fail-closed behavior are proven by the SQL test suite under
 * {@code infra/db/tests}; this only pins the in-process invariants.
 */
class RealtimeResumeServiceTest {

    @Test
    void resumeResultKeepsFields() {
        ResumeResult result = new ResumeResult(
                ResumeResult.DISPOSITION_RESUMED, "[{\"event\":\"chat.accepted\"}]", "null");
        assertEquals(ResumeResult.DISPOSITION_RESUMED, result.disposition());
        assertEquals("[{\"event\":\"chat.accepted\"}]", result.eventsJson());
        assertEquals("null", result.snapshotJson());
    }

    @Test
    void resumeResultRejectsBlankDisposition() {
        assertThrows(IllegalArgumentException.class,
                () -> new ResumeResult("  ", "[]", "null"));
    }

    @Test
    void streamSnapshotKeepsFields() {
        StreamSnapshot snapshot = new StreamSnapshot("COMPLETED", 7001L, "[]");
        assertEquals("COMPLETED", snapshot.status());
        assertEquals(7001L, snapshot.assistantMessageId());
    }

    @Test
    void streamSnapshotAllowsNullAssistantMessageId() {
        StreamSnapshot snapshot = new StreamSnapshot("IN_PROGRESS", null, "[]");
        assertEquals("IN_PROGRESS", snapshot.status());
        assertEquals(null, snapshot.assistantMessageId());
    }

    @Test
    void streamSnapshotRejectsBlankStatus() {
        assertThrows(IllegalArgumentException.class,
                () -> new StreamSnapshot("  ", 1L, "[]"));
    }

    @Test
    void validateResumeAcceptsValidArguments() {
        assertDoesNotThrow(() -> RealtimeResumeService.validateResume(7L, 901L, 1L, 0L));
        assertDoesNotThrow(() -> RealtimeResumeService.validateResume(7L, 901L, 3L, 12L));
    }

    @Test
    void validateResumeRejectsNonPositiveKeys() {
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateResume(0L, 901L, 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateResume(7L, 0L, 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateResume(7L, 901L, 0L, 0L));
    }

    @Test
    void validateResumeRejectsNegativeAfterSeq() {
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateResume(7L, 901L, 1L, -1L));
    }

    @Test
    void validateSnapshotAcceptsAndRejects() {
        assertDoesNotThrow(() -> RealtimeResumeService.validateSnapshot(7L, 901L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateSnapshot(0L, 901L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeResumeService.validateSnapshot(7L, 0L));
    }

    @Test
    void realtimeEventRecordKeepsEnvelopeFields() {
        RealtimeEventRecord event = new RealtimeEventRecord(
                "chat.completed", 901L, 1L, 3L, "2026-08-06T00:00:00Z", "{\"generationId\":901}");
        assertEquals("chat.completed", event.eventType());
        assertEquals(3L, event.eventSeq());
        assertEquals(RealtimeEventRecord.ENVELOPE_SCHEMA_VERSION, 1);
    }

    @Test
    void realtimeEventRecordRejectsInvalidEnvelope() {
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeEventRecord("  ", 901L, 1L, 3L, "t", "{}"));
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeEventRecord("chat.completed", 0L, 1L, 3L, "t", "{}"));
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeEventRecord("chat.completed", 901L, 0L, 3L, "t", "{}"));
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeEventRecord("chat.completed", 901L, 1L, -1L, "t", "{}"));
    }
}
