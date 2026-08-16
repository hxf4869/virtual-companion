package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Process-local registry of in-flight external provider sessions, keyed by
 * generation id (CANCEL-A, Technical Alpha single-runtime assumption).
 *
 * <p>{@link LiveModelInvoker} registers the adapter session for the duration of
 * the external-no-db phase and unregisters it before returning. The HTTP
 * cancellation path resolves the registry after the database terminal state
 * transition ({@code vc.cancel_generation}) has succeeded and forwards the
 * cooperative cancel signal into the running {@code ModelProtocolSession}.
 * The registry is deliberately best-effort: it is NOT the source of truth —
 * the PostgreSQL generation/work-item terminal state is. A missing session
 * (already finished, or a different runtime instance) simply means there is
 * nothing to interrupt; the late finalize is still rejected by the V28 claim
 * guard.</p>
 *
 * <p>Single-writer semantics: at most one worker invokes a generation at a
 * time, so one session per generation id is sufficient; {@link #unregister}
 * removes only the exact registered session to never drop a successor.</p>
 */
public class ActiveInvocationRegistry {

    private final ConcurrentMap<Long, ModelProtocolSession> activeSessions =
            new ConcurrentHashMap<>();

    /** Register the running session for a generation (idempotent per generation). */
    public void register(long generationId, ModelProtocolSession session) {
        Objects.requireNonNull(session, "session must not be null");
        activeSessions.put(generationId, session);
    }

    /** Remove exactly the given session; a different registered session is kept. */
    public void unregister(long generationId, ModelProtocolSession session) {
        Objects.requireNonNull(session, "session must not be null");
        activeSessions.remove(generationId, session);
    }

    /**
     * Forward a cooperative cancel signal to the in-flight session.
     *
     * @return true when a live session was signalled; false when no session is
     *         currently registered for the generation (nothing to interrupt)
     */
    public boolean cancel(long generationId) {
        ModelProtocolSession session = activeSessions.get(generationId);
        if (session == null) {
            return false;
        }
        session.cancel();
        return true;
    }
}
