package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.QuotaReservation;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

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
                eq("SELECT out_provider_attempt_id FROM vc.create_attempt_intent(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(String.class),
                eq(7L), eq(101L), eq(9001L),
                eq(sha256Hex("raw-token")), eq(sha256Hex("FENCE-A")),
                eq("pa-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-req"), eq("snap-exec"), eq("model-id"), eq("model-rev"),
                eq("prompt-v1"), eq("persona-v1"), eq("config-v1")))
                .thenReturn("pa-1");

        String attemptId = service.createAttemptIntent(
                7L, 101L, 9001L, "raw-token", "FENCE-A",
                "pa-1", "alpha-loopback", "alpha-supplier", "snap-req", "snap-exec",
                "model-id", "model-rev", "prompt-v1", "persona-v1", "config-v1");

        assertEquals("pa-1", attemptId);
        // The raw token/fence never appear in the SQL — only their hashes
        // (the eq(...) matchers above would fail if the raw values were passed).
        verify(jdbc).queryForObject(
                eq("SELECT out_provider_attempt_id FROM vc.create_attempt_intent(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(String.class),
                eq(7L), eq(101L), eq(9001L),
                eq(sha256Hex("raw-token")), eq(sha256Hex("FENCE-A")),
                eq("pa-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-req"), eq("snap-exec"), eq("model-id"), eq("model-rev"),
                eq("prompt-v1"), eq("persona-v1"), eq("config-v1"));
    }

    @Test
    void createAttemptIntentRejectsBlankTokenOrFence() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        assertThrows(IllegalArgumentException.class, () -> service.createAttemptIntent(
                7L, 101L, 9001L, "  ", "FENCE-A", "pa-1", "p", "s", "r", "e",
                "m", "mr", "pb", "per", "cfg"));
        assertThrows(IllegalArgumentException.class, () -> service.createAttemptIntent(
                7L, 101L, 9001L, "tok", "  ", "pa-1", "p", "s", "r", "e",
                "m", "mr", "pb", "per", "cfg"));
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
    void recordAttemptOutcomePersistsTelemetryWithTheTerminalTransition() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?, ?, ?)", Integer.class,
                7L, "pa-1", "RETRYABLE_FAILED", 4321L, "HTTP_429")).thenReturn(1);

        assertEquals(1, service.recordAttemptOutcome(
                7L, "pa-1", "RETRYABLE_FAILED", 4321L, "HTTP_429"));
        verify(jdbc).queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?, ?, ?)", Integer.class,
                7L, "pa-1", "RETRYABLE_FAILED", 4321L, "HTTP_429");
    }

    @Test
    void recordAttemptOutcomeRejectsNegativeLatencyBeforeJdbc() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);

        assertThrows(IllegalArgumentException.class, () -> service.recordAttemptOutcome(
                7L, "pa-1", "SUCCEEDED", -1L, null));
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

    @Test
    void recordRouteDecisionPinsInsertOnlySql() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GenerationFinalizeService service = new GenerationFinalizeService(jdbc);
        OwnershipTuple ownership = new OwnershipTuple("7", "1", "2", "9001");
        RouteDecision decision = RouteDecision.selected(
                ownership,
                "SIMULATED",
                new ProviderId("alpha-loopback"),
                new InvocationBinding.ExternalAttemptBinding(
                        ownership, "pa-1", 1L, "snap-req", "snap-exec"),
                new QuotaReservation("qr-1", "7", 1L, 9L),
                List.of(new ProviderId("alpha-loopback")));
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class)))
                .thenReturn(List.of(42L));

        assertEquals(42L, service.recordRouteDecision(7L, 9001L, decision));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(PreparedStatementSetter.class), any(RowMapper.class));
        assertEquals(GenerationFinalizeService.RECORD_ROUTE_DECISION_SQL, sql.getValue());
        assertFalse(sql.getValue().contains("UPDATE"));
        assertFalse(sql.getValue().contains("DELETE"));
    }
}
