package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Pure unit tests for the {@link FinalizeGenerationService.FinalizeResult} value
 * object and the eager {@code validateFinalize} argument checks, plus the
 * TASK-0194 intent/guard/per-item SQL binding of
 * {@link GenerationFinalizeService} (explicit claim guard, attempt intent
 * create/update with hash-only token/fence persistence).
 *
 * <p>The atomic runtime behavior of {@code vc.finalize_generation} (atomic
 * commit or full rollback under fault injection; FINAL_REVIEW precondition;
 * at-most-one final candidate; EXECUTE isolation) is proven by the SQL test
 * suite under {@code infra/db/tests}; this only pins the in-process invariants.
 */
class FinalizeGenerationServiceTest {

    @Test
    void finalizeResultKeepsFields() {
        FinalizeGenerationService.FinalizeResult result =
                new FinalizeGenerationService.FinalizeResult(901L, 7001L, true);
        assertEquals(901L, result.generationId());
        assertEquals(7001L, result.assistantMessageId());
        assertEquals(true, result.finalized());
    }

    @Test
    void finalizeResultRejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class,
                () -> new FinalizeGenerationService.FinalizeResult(0L, 7001L, true));
        assertThrows(IllegalArgumentException.class,
                () -> new FinalizeGenerationService.FinalizeResult(901L, 0L, true));
    }

    @Test
    void validateFinalizeAcceptsValidArguments() {
        assertDoesNotThrow(() -> FinalizeGenerationService.validateFinalize(
                7L, 901L, 500L, "hello", "provider-a", "USD"));
    }

    @Test
    void validateFinalizeRejectsNonPositiveKeys() {
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(0L, 901L, 500L, "x", "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 0L, 500L, "x", "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 0L, "x", "p", "USD"));
    }

    @Test
    void validateFinalizeRejectsNullOrBlankStrings() {
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, null, "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, "x", null, "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, "x", "p", "  "));
    }

    // ---- TASK-0194: GenerationFinalizeService intent / guard / per-item SQL binding ----

    private static String sha256Hex(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Test
    void createAttemptIntentPersistsOnlyHashedTokenAndFence() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        when(jdbc.queryForObject(
                eq("SELECT out_provider_attempt_id FROM vc.create_attempt_intent(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(String.class),
                eq(7L), eq(101L), eq(9001L),
                eq(sha256Hex("raw-token")), eq(sha256Hex("FENCE-A")),
                eq("pa-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-req"), eq("snap-exec")))
                .thenReturn("pa-1");

        String attemptId = service.createAttemptIntent(
                7L, 101L, 9001L, "raw-token", "FENCE-A",
                "pa-1", "alpha-loopback", "alpha-supplier", "snap-req", "snap-exec");

        assertEquals("pa-1", attemptId);
        // The raw token/fence never appear in the SQL — only their hashes
        // (the eq(...) matchers above would fail if the raw values were passed).
        verify(jdbc).queryForObject(
                eq("SELECT out_provider_attempt_id FROM vc.create_attempt_intent(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(String.class),
                eq(7L), eq(101L), eq(9001L),
                eq(sha256Hex("raw-token")), eq(sha256Hex("FENCE-A")),
                eq("pa-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-req"), eq("snap-exec"));
    }

    @Test
    void createAttemptIntentRejectsBlankTokenOrFence() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        assertThrows(IllegalArgumentException.class, () -> service.createAttemptIntent(
                7L, 101L, 9001L, "  ", "FENCE-A", "pa-1", "p", "s", "r", "e"));
        assertThrows(IllegalArgumentException.class, () -> service.createAttemptIntent(
                7L, 101L, 9001L, "tok", "  ", "pa-1", "p", "s", "r", "e"));
    }

    @Test
    void recordAttemptOutcomeUpdatesTheSameIntentRow() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?)", Integer.class,
                7L, "pa-1", "SUCCEEDED")).thenReturn(1);

        assertEquals(1, service.recordAttemptOutcome(7L, "pa-1", "SUCCEEDED"));
        verify(jdbc).queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?)", Integer.class,
                7L, "pa-1", "SUCCEEDED");
    }

    @Test
    void assertActiveClaimBindsExplicitWorkItemTokenAndFence() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.assert_active_claim(?, ?, ?, ?)", Object.class,
                7L, 101L, "tok", "FENCE-A")).thenReturn("ok");

        service.assertActiveClaim(7L, 101L, "tok", "FENCE-A");

        verify(jdbc).queryForObject(
                "SELECT vc.assert_active_claim(?, ?, ?, ?)", Object.class,
                7L, 101L, "tok", "FENCE-A");
    }

    @Test
    void perItemTerminalizeBindsExplicitTriple() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.complete_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A"))
                .thenReturn(1);
        when(jdbc.queryForObject(
                "SELECT vc.fail_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A"))
                .thenReturn(0);

        assertEquals(1, service.completeWorkItem(101L, "tok", "FENCE-A"));
        assertEquals(0, service.failWorkItem(101L, "tok", "FENCE-A"));
        verify(jdbc).queryForObject(
                "SELECT vc.complete_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A");
        verify(jdbc).queryForObject(
                "SELECT vc.fail_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A");
    }
}

