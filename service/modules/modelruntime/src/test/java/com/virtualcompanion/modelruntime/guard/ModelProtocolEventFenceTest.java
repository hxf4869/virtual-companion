package com.virtualcompanion.modelruntime.guard;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ModelProtocolEventFenceTest {

    @Test
    void acceptsOnlyTheCompleteExpectedBinding() {
        var expected = binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-1"),
                "source-1", 7);
        var fence = new ModelProtocolEventFence(expected);
        var accepted = delta(expected, 0);

        assertSame(accepted, fence.accept(accepted));

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
        mismatches.forEach(mismatch -> {
            var fresh = new ModelProtocolEventFence(expected);
            assertThrows(
                    ModelProtocolEventFence.FenceViolation.class,
                    () -> fresh.accept(delta(mismatch, 0)));
        });
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

        assertThrows(
                ModelProtocolEventFence.FenceViolation.class,
                () -> new ModelProtocolEventFence(differentExecutionAuthorization)
                        .accept(delta(eventBinding, 0)));
    }

    @Test
    void sequencesMustBeContiguousFromZero() {
        var fence = new ModelProtocolEventFence(EXTERNAL_BINDING);
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(delta(EXTERNAL_BINDING, 1)));
        fence.accept(delta(EXTERNAL_BINDING, 0));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(delta(EXTERNAL_BINDING, 0)));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(delta(EXTERNAL_BINDING, 2)));
        fence.accept(delta(EXTERNAL_BINDING, 1));
        fence.accept(new ModelProtocolEvent.UsageReported(
                EXTERNAL_BINDING, 2, new TokenUsage(1, 1, 2)));
    }

    @Test
    void usageMayBeReportedAtMostOnce() {
        var fence = new ModelProtocolEventFence(EXTERNAL_BINDING);
        fence.accept(delta(EXTERNAL_BINDING, 0));
        fence.accept(new ModelProtocolEvent.UsageReported(
                EXTERNAL_BINDING, 1, new TokenUsage(1, 1, 2)));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(new ModelProtocolEvent.UsageReported(
                        EXTERNAL_BINDING, 2, new TokenUsage(2, 2, 4))));
    }

    @Test
    void eosWithoutAnyOutputIsRejected() {
        var fence = new ModelProtocolEventFence(EXTERNAL_BINDING);
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(new ModelProtocolEvent.AttemptEos(
                        EXTERNAL_BINDING, 0, StopReason.STOP)));
    }

    @Test
    void eosWithOutputIsAcceptedAndClosesTheGate() {
        var fence = new ModelProtocolEventFence(EXTERNAL_BINDING);
        fence.accept(delta(EXTERNAL_BINDING, 0));
        fence.accept(new ModelProtocolEvent.AttemptEos(EXTERNAL_BINDING, 1, StopReason.STOP));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> fence.accept(delta(EXTERNAL_BINDING, 2)));
    }

    @Test
    void failureAndCancellationCloseTheGateWithoutRequiringOutput() {
        var failed = new ModelProtocolEventFence(EXTERNAL_BINDING);
        failed.accept(new ModelProtocolEvent.AttemptFailed(
                EXTERNAL_BINDING, 0, new AdapterFailure.UpstreamUnavailable()));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> failed.accept(delta(EXTERNAL_BINDING, 1)));

        var cancelled = new ModelProtocolEventFence(EXTERNAL_BINDING);
        cancelled.accept(new ModelProtocolEvent.AttemptCancelled(EXTERNAL_BINDING, 0));
        assertThrows(ModelProtocolEventFence.FenceViolation.class,
                () -> cancelled.accept(delta(EXTERNAL_BINDING, 1)));
    }

    private static final InvocationBinding.ExternalAttemptBinding EXTERNAL_BINDING =
            new InvocationBinding.ExternalAttemptBinding(
                    ownership("owner-1", "relationship-1", "conversation-1", "generation-1"),
                    "attempt-1",
                    3,
                    "requested-auth-1",
                    "execution-auth-1"
            );

    private static ModelProtocolEvent.OutputDelta delta(
            InvocationBinding binding,
            long sequence) {
        return new ModelProtocolEvent.OutputDelta(
                binding,
                sequence,
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
