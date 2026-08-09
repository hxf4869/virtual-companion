package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

/**
 * Test fixture: an in-process adapter whose session events are produced by a
 * {@code Function<InvocationBinding, List<ModelProtocolEvent>>} script. The
 * script is applied to the request binding at open time so events always carry
 * the correct external-attempt binding, and open calls are recorded so tests
 * can assert that a blocked path performed zero outbound transfers.
 */
final class ScriptedAdapter implements ModelProtocolAdapter {

    private final ModelProtocol protocol;
    private final ModelProtocolCapabilities capabilities;
    private final Function<InvocationBinding, List<ModelProtocolEvent>> script;
    private final int nextFailureAfterEvents;
    private final RuntimeException nextFailure;
    private final List<InvocationBinding> openedBindings = new ArrayList<>();
    private final AtomicInteger cancellations = new AtomicInteger();

    ScriptedAdapter(
            ModelProtocol protocol,
            ModelProtocolCapabilities capabilities,
            Function<InvocationBinding, List<ModelProtocolEvent>> script) {
        this(protocol, capabilities, script, -1, null);
    }

    ScriptedAdapter(
            ModelProtocol protocol,
            ModelProtocolCapabilities capabilities,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            int nextFailureAfterEvents,
            RuntimeException nextFailure) {
        this.protocol = protocol;
        this.capabilities = capabilities;
        this.script = script;
        this.nextFailureAfterEvents = nextFailureAfterEvents;
        this.nextFailure = nextFailure;
    }

    @Override
    public ModelProtocol protocol() {
        return protocol;
    }

    @Override
    public ModelProtocolCapabilities capabilities() {
        return capabilities;
    }

    @Override
    public ModelProtocolSession open(ModelProtocolRequest request) {
        openedBindings.add(request.binding());
        return new ScriptedSession(
                script.apply(request.binding()),
                cancellations,
                nextFailureAfterEvents,
                nextFailure);
    }

    /** Number of times {@code open} was called (zero means no outbound transfer). */
    int openCount() {
        return openedBindings.size();
    }

    int cancelCount() {
        return cancellations.get();
    }

    private static final class ScriptedSession implements ModelProtocolSession {

        private final List<ModelProtocolEvent> events;
        private final AtomicInteger cancellations;
        private final int nextFailureAfterEvents;
        private final RuntimeException nextFailure;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final AtomicBoolean failureRaised = new AtomicBoolean();
        private int index;

        ScriptedSession(
                List<ModelProtocolEvent> events,
                AtomicInteger cancellations,
                int nextFailureAfterEvents,
                RuntimeException nextFailure) {
            this.events = events;
            this.cancellations = cancellations;
            this.nextFailureAfterEvents = nextFailureAfterEvents;
            this.nextFailure = nextFailure;
        }

        @Override
        public Optional<ModelProtocolEvent> next() {
            if (nextFailure != null
                    && index == nextFailureAfterEvents
                    && failureRaised.compareAndSet(false, true)) {
                throw nextFailure;
            }
            if (index < events.size()) {
                return Optional.of(events.get(index++));
            }
            return Optional.empty();
        }

        @Override
        public void cancel() {
            if (cancelled.compareAndSet(false, true)) {
                cancellations.incrementAndGet();
            }
        }

        @Override
        public void close() {
        }
    }
}
