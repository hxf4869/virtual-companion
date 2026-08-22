package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * CANCEL-A registry contract: the process-local active-invocation registry
 * forwards a cooperative cancel signal to exactly the registered in-flight
 * session, and never to an unknown generation or a superseded session.
 * (No Mockito in this module — a recording fake session stands in.)
 */
class ActiveInvocationRegistryTest {

    private static final class RecordingSession implements ModelProtocolSession {

        boolean cancelled;

        @Override
        public Optional<ModelProtocolEvent> next() {
            return Optional.empty();
        }

        @Override
        public void cancel() {
            cancelled = true;
        }

        @Override
        public void close() {
            // nothing to release
        }
    }

    @Test
    void cancelSignalsTheRegisteredSession() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();
        RecordingSession session = new RecordingSession();
        registry.register(42L, session);

        assertTrue(registry.cancel(42L));
        assertTrue(session.cancelled);
    }

    @Test
    void cancelWithoutRegistrationSignalsNothing() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();

        assertFalse(registry.cancel(42L));
    }

    @Test
    void unregisterRemovesOnlyTheExactSession() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();
        RecordingSession first = new RecordingSession();
        RecordingSession successor = new RecordingSession();
        registry.register(42L, first);
        registry.register(42L, successor);

        // A stale unregister for the earlier session must not drop the successor.
        registry.unregister(42L, first);
        assertTrue(registry.cancel(42L));
        assertTrue(successor.cancelled);
        assertFalse(first.cancelled);

        registry.unregister(42L, successor);
        assertFalse(registry.cancel(42L));
    }

    @Test
    void generationsAreIsolatedPerKey() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();
        RecordingSession a = new RecordingSession();
        RecordingSession b = new RecordingSession();
        registry.register(1L, a);
        registry.register(2L, b);

        assertTrue(registry.cancel(2L));
        assertTrue(b.cancelled);
        assertFalse(a.cancelled);
        assertTrue(registry.cancel(1L));
        assertTrue(a.cancelled);

        registry.unregister(1L, a);
        registry.unregister(2L, b);
        assertFalse(registry.cancel(1L));
        assertFalse(registry.cancel(2L));
    }

    @Test
    void cancelOwnerSignalsOnlyThatOwnersSessions() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();
        RecordingSession a = new RecordingSession();
        RecordingSession b = new RecordingSession();
        registry.register(1L, 7L, a);
        registry.register(2L, 8L, b);

        assertEquals(1, registry.cancelOwner(7L));
        assertTrue(a.cancelled);
        assertFalse(b.cancelled);
    }
}
