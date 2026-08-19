package com.virtualcompanion.runtime.auth.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class OwnerContextTest {

    private static final String TEST_KEY =
            "0123456789abcdef0123456789abcdef";

    @Test
    void bindingMessageIsDomainSeparatedAndBindsAllFourComponents() {
        String message = OwnerContext.bindingMessage(42L, "1234", "5678", "abcdef");
        assertThat(message).isEqualTo("vc-owner-binding-v1|42|1234|5678|abcdef");
        // Every component changes the message: owner, pid, xact, nonce.
        assertThat(OwnerContext.bindingMessage(43L, "1234", "5678", "abcdef"))
                .isNotEqualTo(message);
        assertThat(OwnerContext.bindingMessage(42L, "1235", "5678", "abcdef"))
                .isNotEqualTo(message);
        assertThat(OwnerContext.bindingMessage(42L, "1234", "5679", "abcdef"))
                .isNotEqualTo(message);
        assertThat(OwnerContext.bindingMessage(42L, "1234", "5678", "abcdeg"))
                .isNotEqualTo(message);
    }

    @Test
    void proofIsDeterministicHmacAndNeverContainsTheKey() {
        OwnerContext ownerContext = new OwnerContext(mock(JdbcTemplate.class), mock(TransactionTemplate.class), TEST_KEY);
        String proof = ownerContext.proofFor(42L, "1234", "5678", "abcdef");
        assertThat(proof).hasSize(64).matches("[0-9a-f]{64}");
        assertThat(proof).isEqualTo(ownerContext.proofFor(42L, "1234", "5678", "abcdef"));
        assertThat(proof).isNotEqualTo(ownerContext.proofFor(43L, "1234", "5678", "abcdef"));
        assertThat(proof).doesNotContain(TEST_KEY);
    }

    @Test
    void rejectsMissingOrTooShortBindingSecret() {
        assertThatThrownBy(() -> new OwnerContext(
                mock(JdbcTemplate.class), mock(TransactionTemplate.class), null))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OwnerContext(
                mock(JdbcTemplate.class), mock(TransactionTemplate.class), ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OwnerContext(
                mock(JdbcTemplate.class), mock(TransactionTemplate.class), "short"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void asOwnerBindsContextThroughSetOwnerContextWithFreshProof() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        when(jdbc.queryForMap(anyString())).thenReturn(Map.of("pid", 4321, "xact", "87654321"));
        doAnswer(invocation -> {
            Consumer<?> consumer = invocation.getArgument(0);
            consumer.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions, TEST_KEY);

        String[] seenNonce = new String[1];
        doAnswer(invocation -> {
            seenNonce[0] = invocation.getArgument(3);
            return null;
        }).when(jdbc).query(
                eq("SELECT vc.set_owner_context(?, ?, ?)"),
                any(org.springframework.jdbc.core.ResultSetExtractor.class),
                eq(42L), anyString(), anyString());

        AtomicBoolean ran = new AtomicBoolean(false);
        ownerContext.asOwner(42L, () -> ran.set(true));

        assertThat(ran.get()).isTrue();
        verify(jdbc).queryForMap("SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xact");
        // The proof passed to the database verifies against the same tuple the
        // server will recompute (owner 42, this pid, this xact, this nonce) and
        // never carries the key material.
        var args = org.mockito.Mockito.mockingDetails(jdbc).getInvocations().stream()
                .filter(inv -> "query".equals(inv.getMethod().getName()))
                .filter(inv -> inv.getArguments().length == 5)
                .findFirst().orElseThrow();
        Long owner = args.getArgument(2);
        String nonce = args.getArgument(3);
        String proof = args.getArgument(4);
        assertThat(owner).isEqualTo(42L);
        assertThat(nonce).matches("[0-9a-f]{32}");
        assertThat(proof).isEqualTo(ownerContext.proofFor(42L, "4321", "87654321", nonce));
        assertThat(proof).doesNotContain(TEST_KEY);
        seenNonce[0] = nonce;
    }

    @Test
    void asOwnerGeneratesAFreshNoncePerCall() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        when(jdbc.queryForMap(anyString())).thenReturn(Map.of("pid", 1, "xact", "1"));
        doAnswer(invocation -> {
            Consumer<?> consumer = invocation.getArgument(0);
            consumer.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions, TEST_KEY);

        java.util.Set<String> nonces = new java.util.HashSet<>();
        doAnswer(invocation -> {
            nonces.add(invocation.getArgument(3));
            return null;
        }).when(jdbc).query(
                eq("SELECT vc.set_owner_context(?, ?, ?)"),
                any(org.springframework.jdbc.core.ResultSetExtractor.class),
                eq(42L), anyString(), anyString());

        ownerContext.asOwner(42L, () -> { });
        ownerContext.asOwner(42L, () -> { });

        assertThat(nonces).hasSize(2);
    }

    @Test
    void perSegmentOwnerProofIsReEstablishedForEverySegmentTransaction() {
        // TASK-0194: every short segment transaction must re-establish the V27
        // owner proof (the proof binds pg_current_xact_id, which changes per
        // transaction). Two segments must produce two distinct
        // (xact, nonce, proof) tuples and bind the context before each segment's
        // work runs.
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        java.util.List<String> ranSegments = new java.util.ArrayList<>();
        java.util.List<String> observedProofs = new java.util.ArrayList<>();
        java.util.List<String> observedNonces = new java.util.ArrayList<>();
        java.util.concurrent.atomic.AtomicInteger segmentIndex = new java.util.concurrent.atomic.AtomicInteger();
        // Each segment transaction runs under its own transaction id; the proof
        // minted for the segment must bind exactly that id.
        when(jdbc.queryForMap("SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xact"))
                .thenAnswer(invocation ->
                        Map.of("pid", 7, "xact", "xact-" + segmentIndex.get()));
        doAnswer(invocation -> {
            Consumer<?> consumer = invocation.getArgument(0);
            consumer.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        doAnswer(invocation -> {
            observedNonces.add(invocation.getArgument(3));
            observedProofs.add(invocation.getArgument(4));
            segmentIndex.incrementAndGet();
            return null;
        }).when(jdbc).query(
                eq("SELECT vc.set_owner_context(?, ?, ?)"),
                any(org.springframework.jdbc.core.ResultSetExtractor.class),
                eq(42L), anyString(), anyString());
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions, TEST_KEY);

        ownerContext.asOwner(42L, () -> ranSegments.add("segment-0"));
        ownerContext.asOwner(42L, () -> ranSegments.add("segment-1"));

        // Both segments ran, each after its own fresh proof for its own
        // transaction id — no proof reuse across segments.
        assertThat(ranSegments).containsExactly("segment-0", "segment-1");
        assertThat(observedProofs).hasSize(2);
        assertThat(observedProofs.get(0)).isNotEqualTo(observedProofs.get(1));
        assertThat(observedProofs.get(0))
                .isEqualTo(ownerContext.proofFor(42L, "7", "xact-0", observedNonces.get(0)));
        assertThat(observedProofs.get(1))
                .isEqualTo(ownerContext.proofFor(42L, "7", "xact-1", observedNonces.get(1)));
        assertThat(observedNonces.get(0)).isNotEqualTo(observedNonces.get(1));
    }

    @Test
    void asOwnerRejectsNonPositiveOwnerBeforeAnyWork() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        OwnerContext ownerContext = new OwnerContext(jdbc, transactions, TEST_KEY);

        assertThatThrownBy(() -> ownerContext.asOwner(0L, () -> { }))
                .isInstanceOf(IllegalArgumentException.class);
        verify(transactions, never()).executeWithoutResult(any());
    }
}
