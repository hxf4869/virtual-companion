package com.virtualcompanion.modelruntime.guard;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelProtocolEventFenceTest {

    @Test
    void acceptsOnlyTheCompleteExpectedBinding() {
        var expected = binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-1"),
                "source-1", 7);
        var event = delta(expected);

        assertSame(event, ModelProtocolEventFence.accept(expected, event).orElseThrow());

        var mismatches = List.of(
                binding(ownership("owner-2", "relationship-1", "conversation-1", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-2", "conversation-1", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-2", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-2"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-1"),
                        "source-2", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-1"),
                        "source-1", 8)
        );

        assertEquals(6, mismatches.size());
        mismatches.forEach(mismatch ->
                assertTrue(ModelProtocolEventFence.accept(mismatch, event).isEmpty())
        );
    }

    @Test
    void externalBindingAlsoFencesAuthorizationSnapshots() {
        var ownership = ownership("owner-1", "relationship-1", "conversation-1", "generation-1");
        var eventBinding = new InvocationBinding.ExternalAttemptBinding(
                ownership,
                "attempt-1",
                3,
                "requested-auth-1",
                "execution-auth-1"
        );
        var differentExecutionAuthorization = new InvocationBinding.ExternalAttemptBinding(
                ownership,
                "attempt-1",
                3,
                "requested-auth-1",
                "execution-auth-2"
        );

        assertTrue(ModelProtocolEventFence.accept(
                differentExecutionAuthorization,
                delta(eventBinding)
        ).isEmpty());
    }

    private static ModelProtocolEvent.OutputDelta delta(InvocationBinding binding) {
        return new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("delta")
        );
    }

    private static InvocationBinding.DeterministicSourceBinding binding(
            OwnershipTuple ownership,
            String sourceId,
            long fence
    ) {
        return new InvocationBinding.DeterministicSourceBinding(ownership, sourceId, fence);
    }

    private static OwnershipTuple ownership(
            String owner,
            String relationship,
            String conversation,
            String generation
    ) {
        return new OwnershipTuple(owner, relationship, conversation, generation);
    }
}
