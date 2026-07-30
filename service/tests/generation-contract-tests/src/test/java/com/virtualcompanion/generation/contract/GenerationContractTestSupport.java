package com.virtualcompanion.generation.contract;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.conversation.generation.AttemptEventResult;
import com.virtualcompanion.conversation.generation.FrozenGenerationCandidate;
import com.virtualcompanion.conversation.generation.GenerationAttemptReducer;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

final class GenerationContractTestSupport {

    private GenerationContractTestSupport() {
    }

    static OwnershipTuple ownership() {
        return ownership(
                "owner-1",
                "relationship-1",
                "conversation-1",
                "generation-1"
        );
    }

    static OwnershipTuple ownership(
            String ownerId,
            String relationshipId,
            String conversationId,
            String generationId
    ) {
        return new OwnershipTuple(
                ownerId,
                relationshipId,
                conversationId,
                generationId
        );
    }

    static InvocationBinding.DeterministicSourceBinding deterministicBinding(
            String sourceId,
            long fence
    ) {
        return deterministicBinding(ownership(), sourceId, fence);
    }

    static InvocationBinding.DeterministicSourceBinding deterministicBinding(
            OwnershipTuple ownership,
            String sourceId,
            long fence
    ) {
        return new InvocationBinding.DeterministicSourceBinding(
                ownership,
                sourceId,
                fence
        );
    }

    static InvocationBinding.ExternalAttemptBinding externalBinding(
            String attemptId,
            long fence,
            String requestedAuthorizationSnapshotId,
            String executionAuthorizationSnapshotId
    ) {
        return new InvocationBinding.ExternalAttemptBinding(
                ownership(),
                attemptId,
                fence,
                requestedAuthorizationSnapshotId,
                executionAuthorizationSnapshotId
        );
    }

    static ModelProtocolRequest textRequest(
            InvocationBinding binding,
            boolean streaming
    ) {
        return new ModelProtocolRequest(
                binding,
                List.of(new ProtocolMessage(
                        ProtocolMessage.Role.USER,
                        "synthetic generation contract input"
                )),
                new ResponseMode.Text(),
                streaming,
                timeoutBudget()
        );
    }

    static ModelProtocolRequest structuredRequest(InvocationBinding binding) {
        return new ModelProtocolRequest(
                binding,
                List.of(new ProtocolMessage(
                        ProtocolMessage.Role.USER,
                        "synthetic structured generation contract input"
                )),
                new ResponseMode.StructuredJson(
                        "generation-contract",
                        "{\"type\":\"object\"}"
                ),
                false,
                timeoutBudget()
        );
    }

    static List<ModelProtocolEvent> events(
            ModelProtocolAdapter adapter,
            ModelProtocolRequest request
    ) {
        var session = adapter.open(request);
        var events = new ArrayList<ModelProtocolEvent>();
        for (int index = 0; index < 100_000; index++) {
            var event = session.next();
            if (event.isEmpty()) {
                return List.copyOf(events);
            }
            events.add(event.orElseThrow());
        }
        throw new AssertionError("adapter session did not terminate");
    }

    static List<AttemptEventResult> reduce(
            GenerationAttemptReducer reducer,
            List<ModelProtocolEvent> events
    ) {
        return events.stream()
                .map(reducer::accept)
                .toList();
    }

    static FrozenGenerationCandidate textCandidate(
            InvocationBinding binding,
            String candidateId,
            String text
    ) {
        var reducer = new GenerationAttemptReducer(
                binding,
                candidateId,
                GenerationState.IN_PROGRESS
        );
        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk(text)
        ));
        reducer.accept(new ModelProtocolEvent.AttemptEos(
                binding,
                1,
                StopReason.STOP
        ));
        return reducer.candidate().orElseThrow();
    }

    private static TimeoutBudget timeoutBudget() {
        return new TimeoutBudget(
                Duration.ofSeconds(1),
                Duration.ofSeconds(2),
                Duration.ofSeconds(3)
        );
    }
}
