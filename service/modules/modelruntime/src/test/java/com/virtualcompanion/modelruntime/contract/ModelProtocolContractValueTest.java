package com.virtualcompanion.modelruntime.contract;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelProtocolContractValueTest {

    @Test
    void requestDefensivelyCopiesMessages() {
        var messages = new ArrayList<>(List.of(
                new ProtocolMessage(ProtocolMessage.Role.USER, "你好")
        ));
        var request = new ModelProtocolRequest(
                deterministicBinding(),
                messages,
                new ResponseMode.Text(),
                true,
                timeoutBudget()
        );

        messages.add(new ProtocolMessage(ProtocolMessage.Role.ASSISTANT, "later"));

        assertEquals(1, request.messages().size());
        assertNotSame(messages, request.messages());
        assertThrows(
                UnsupportedOperationException.class,
                () -> request.messages().add(new ProtocolMessage(ProtocolMessage.Role.USER, "blocked"))
        );
    }

    @Test
    void capabilitiesDefensivelyCopyTheirSet() {
        var source = new java.util.HashSet<>(
                Set.of(ModelProtocolCapabilities.Capability.STREAMING)
        );
        var capabilities = new ModelProtocolCapabilities(source);

        source.clear();

        assertTrue(capabilities.supports(ModelProtocolCapabilities.Capability.STREAMING));
        assertThrows(
                UnsupportedOperationException.class,
                () -> capabilities.values().add(
                        ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
                )
        );
    }

    @Test
    void externalAttemptRequiresBothAuthorizationSnapshots() {
        var ownership = ownership();

        assertThrows(
                IllegalArgumentException.class,
                () -> new InvocationBinding.ExternalAttemptBinding(
                        ownership,
                        "attempt-1",
                        1,
                        "",
                        "execution-auth-1"
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new InvocationBinding.ExternalAttemptBinding(
                        ownership,
                        "attempt-1",
                        1,
                        "requested-auth-1",
                        ""
                )
        );
    }

    @Test
    void whitespaceTextDeltaIsValidButEmptyDeltaIsNot() {
        assertEquals(" ", new ModelPayload.TextChunk(" ").text());
        assertThrows(
                IllegalArgumentException.class,
                () -> new ModelPayload.TextChunk("")
        );
    }

    @Test
    void onlyAttemptTerminalEventsReportTerminal() {
        var binding = deterministicBinding();

        assertTrue(new ModelProtocolEvent.AttemptEos(binding, 0, StopReason.STOP).terminal());
        assertTrue(new ModelProtocolEvent.AttemptFailed(
                binding,
                0,
                new AdapterFailure.RateLimited()
        ).terminal());
        assertTrue(new ModelProtocolEvent.AttemptCancelled(binding, 0).terminal());
    }

    private static InvocationBinding.DeterministicSourceBinding deterministicBinding() {
        return new InvocationBinding.DeterministicSourceBinding(
                ownership(),
                "deterministic-source-1",
                1
        );
    }

    private static OwnershipTuple ownership() {
        return new OwnershipTuple("owner-1", "relationship-1", "conversation-1", "generation-1");
    }

    private static TimeoutBudget timeoutBudget() {
        return new TimeoutBudget(
                Duration.ofSeconds(1),
                Duration.ofSeconds(2),
                Duration.ofSeconds(3)
        );
    }
}
