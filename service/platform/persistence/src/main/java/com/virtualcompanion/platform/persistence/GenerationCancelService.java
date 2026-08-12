package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Generation cancellation over the V10 {@code vc.cancel_generation} SECURITY
 * DEFINER function (TASK-0179).
 *
 * <p>The SD function transitions a cancellable non-terminal generation
 * (CREATED / INPUT_REVIEW / QUEUED / IN_PROGRESS / WAITING_FOR_CAPACITY /
 * FINAL_REVIEW) to {@code CANCELLED} via the catalog double-hop
 * {@code CANCEL_REQUESTED → CANCELLED}; COMMITTING and every terminal state are
 * rejected with a RAISE, and a foreign or absent id raises identically
 * (existence never disclosed).
 *
 * <p>Existence and cancellability are pre-checked through
 * {@link GenerationRepository#find} (mirroring the catalog's cancellable state
 * set) so the common not-owned / absent case maps to {@link Optional#empty()}
 * (the HTTP layer renders 404 NOT_FOUND_OR_FORBIDDEN) and a terminal or
 * COMMITTING state fails fast as an invalid request — both without relying on
 * the RAISE. The SD function remains the authority and guards the transition
 * under FOR UPDATE; a RAISE after the pre-check means the state moved
 * concurrently and is translated to an {@link IllegalArgumentException}. The
 * translation is required because the global auth advice maps a leaked
 * {@link DataAccessException} to 401 AUTHENTICATION_REQUIRED, which would be
 * misleading for a state-conflict request. Schema-unavailable failures
 * ({@link BadSqlGrammarException}, SQLSTATE 42883/42P01/42703/3F000) are
 * rethrown so the existing 503 SCHEMA_UNAVAILABLE contract is preserved.
 */
public class GenerationCancelService {

    private static final String CANCELLED = "CANCELLED";

    /** Cancellable states mirroring the V10 catalog transition graph. */
    private static final Set<String> CANCELLABLE_STATES = Set.of(
            "CREATED", "INPUT_REVIEW", "QUEUED", "IN_PROGRESS",
            "WAITING_FOR_CAPACITY", "FINAL_REVIEW");

    private final JdbcTemplate jdbc;
    private final GenerationRepository generationRepository;

    public GenerationCancelService(
            JdbcTemplate jdbc, GenerationRepository generationRepository) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.generationRepository = Objects.requireNonNull(
                generationRepository, "generationRepository must not be null");
    }

    /**
     * Cancel a cancellable generation.
     *
     * @return the updated generation (status {@code CANCELLED}), or empty for a
     *         foreign or absent id (NOT_FOUND_OR_FORBIDDEN)
     * @throws IllegalArgumentException if the generation exists but is not
     *         cancellable in its current state
     */
    public Optional<GenerationRecord> cancel(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        GenerationRecord existing =
                generationRepository.find(ownerUserId, generationId).orElse(null);
        if (existing == null) {
            return Optional.empty();
        }
        if (!CANCELLABLE_STATES.contains(existing.status())) {
            throw new IllegalArgumentException(
                    "generation " + generationId
                            + " is not cancellable in its current state");
        }
        String status;
        try {
            status = jdbc.queryForObject(
                    "SELECT vc.cancel_generation(?, ?)",
                    String.class,
                    ownerUserId,
                    generationId);
        } catch (BadSqlGrammarException e) {
            // Schema unavailable: keep the existing 503 SCHEMA_UNAVAILABLE
            // classification instead of folding it into a state-conflict 400.
            throw e;
        } catch (DataAccessException e) {
            // The pre-check passed, so a RAISE here means the state moved
            // concurrently (e.g. the worker finalized) and the SD guard
            // rejected the cancel; surface it as an invalid request.
            throw new IllegalArgumentException(
                    "generation " + generationId
                            + " is not cancellable in its current state",
                    e);
        }
        if (!CANCELLED.equals(status)) {
            throw new IllegalStateException(
                    "cancel_generation returned unexpected status: " + status);
        }
        return generationRepository.find(ownerUserId, generationId);
    }
}
