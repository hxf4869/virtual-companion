package com.virtualcompanion.runtime.loopback;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link LoopbackModelProtocolAdapter} (TASK-0181): the FAKE
 * protocol adapter accepts exactly an {@code ExternalAttemptBinding} and
 * replays the deterministic loopback stream; a deterministic-source binding
 * fails closed with the UnsupportedBinding terminal.
 */
class LoopbackModelProtocolAdapterTest {

    private static final OwnershipTuple OWNERSHIP = new OwnershipTuple("1", "9", "5", "10");

    private static ModelProtocolRequest externalRequest() {
        InvocationBinding binding = new InvocationBinding.ExternalAttemptBinding(
                OWNERSHIP, "pa-1", 42L, "snap-req-1", "snap-exec-1");
        return request(binding);
    }

    private static ModelProtocolRequest deterministicRequest() {
        InvocationBinding binding = new InvocationBinding.DeterministicSourceBinding(
                OWNERSHIP, "ZERO_LLM_FALLBACK", 42L);
        return request(binding);
    }

    private static ModelProtocolRequest request(InvocationBinding binding) {
        return new ModelProtocolRequest(
                binding,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hello")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    @Test
    void advertisesFakeProtocolWithEmptyCapabilities() {
        LoopbackModelProtocolAdapter adapter = new LoopbackModelProtocolAdapter();
        assertEquals(ModelProtocol.FAKE, adapter.protocol());
        assertEquals(new ModelProtocolCapabilities(Set.of()), adapter.capabilities());
    }

    @Test
    void replaysDeterministicSuccessStreamForExternalBinding() {
        LoopbackModelProtocolAdapter adapter = new LoopbackModelProtocolAdapter();
        InvocationBinding binding = externalRequest().binding();

        try (ModelProtocolSession session = adapter.open(externalRequest())) {
            Optional<ModelProtocolEvent> first = session.next();
            assertTrue(first.isPresent());
            ModelProtocolEvent delta = first.get();
            assertInstanceOf(ModelProtocolEvent.OutputDelta.class, delta);
            assertEquals(0L, delta.sequence());
            assertEquals(binding, delta.binding());
            assertEquals(LoopbackModelProtocolAdapter.LOOPBACK_RESPONSE,
                    ((ModelPayload.TextChunk)
                            ((ModelProtocolEvent.OutputDelta) delta).payload()).text());

            Optional<ModelProtocolEvent> second = session.next();
            assertTrue(second.isPresent());
            ModelProtocolEvent usage = second.get();
            assertInstanceOf(ModelProtocolEvent.UsageReported.class, usage);
            assertEquals(1L, usage.sequence());
            assertEquals(LoopbackModelProtocolAdapter.INPUT_TOKENS,
                    ((ModelProtocolEvent.UsageReported) usage).usage().inputTokens());
            assertEquals(LoopbackModelProtocolAdapter.OUTPUT_TOKENS,
                    ((ModelProtocolEvent.UsageReported) usage).usage().outputTokens());

            Optional<ModelProtocolEvent> third = session.next();
            assertTrue(third.isPresent());
            ModelProtocolEvent eos = third.get();
            assertInstanceOf(ModelProtocolEvent.AttemptEos.class, eos);
            assertEquals(2L, eos.sequence());
            assertEquals(StopReason.STOP, ((ModelProtocolEvent.AttemptEos) eos).stopReason());
            assertTrue(eos.terminal());

            assertTrue(session.next().isEmpty());
        }
    }

    @Test
    void failsClosedForDeterministicSourceBinding() {
        LoopbackModelProtocolAdapter adapter = new LoopbackModelProtocolAdapter();

        try (ModelProtocolSession session = adapter.open(deterministicRequest())) {
            Optional<ModelProtocolEvent> first = session.next();
            assertTrue(first.isPresent());
            ModelProtocolEvent event = first.get();
            assertInstanceOf(ModelProtocolEvent.AttemptFailed.class, event);
            assertInstanceOf(AdapterFailure.UnsupportedBinding.class,
                    ((ModelProtocolEvent.AttemptFailed) event).failure());
            assertTrue(event.terminal());
            assertTrue(session.next().isEmpty());
        }
    }

    @Test
    void cancelBeforeTerminalProducesCancelledTerminal() {
        LoopbackModelProtocolAdapter adapter = new LoopbackModelProtocolAdapter();

        try (ModelProtocolSession session = adapter.open(externalRequest())) {
            session.next();
            session.cancel();
            Optional<ModelProtocolEvent> next = session.next();
            assertTrue(next.isPresent());
            assertInstanceOf(ModelProtocolEvent.AttemptCancelled.class, next.get());
            assertTrue(next.get().terminal());
            assertTrue(session.next().isEmpty());
        }
    }
}
