package com.virtualcompanion.modelprotocol.contract;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

final class ModelProtocolTestSupport {

    private ModelProtocolTestSupport() {
    }

    static OwnershipTuple ownership() {
        return ownership("owner-1", "relationship-1", "conversation-1", "generation-1");
    }

    static OwnershipTuple ownership(
            String ownerId,
            String relationshipId,
            String conversationId,
            String generationId
    ) {
        return new OwnershipTuple(ownerId, relationshipId, conversationId, generationId);
    }

    static InvocationBinding.DeterministicSourceBinding binding() {
        return binding(ownership(), "source-1", 7);
    }

    static InvocationBinding.DeterministicSourceBinding binding(
            OwnershipTuple ownership,
            String sourceId,
            long fence
    ) {
        return new InvocationBinding.DeterministicSourceBinding(ownership, sourceId, fence);
    }

    static ModelProtocolRequest textRequest(
            InvocationBinding binding,
            boolean streaming,
            String content
    ) {
        return request(binding, streaming, new ResponseMode.Text(), content);
    }

    static ModelProtocolRequest structuredRequest(
            InvocationBinding binding,
            boolean streaming,
            String content
    ) {
        return request(
                binding,
                streaming,
                new ResponseMode.StructuredJson(
                        "companion-response",
                        "{\"type\":\"object\",\"required\":[\"answer\"]}"
                ),
                content
        );
    }

    static List<ModelProtocolEvent> drain(ModelProtocolSession session) {
        var events = new ArrayList<ModelProtocolEvent>();
        for (int index = 0; index < 10_000; index++) {
            var event = session.next();
            if (event.isEmpty()) {
                break;
            }
            events.add(event.orElseThrow());
        }

        assertTrue(events.size() < 10_000, "session did not terminate");
        assertEquals(1, events.stream().filter(ModelProtocolEvent::terminal).count());
        assertTrue(events.getLast().terminal(), "the only terminal event must be last");
        for (int index = 0; index < events.size(); index++) {
            assertEquals(index, events.get(index).sequence(), "event sequence must be contiguous");
        }
        if (session.next().isPresent()) {
            fail("terminal session emitted another event");
        }
        return List.copyOf(events);
    }

    private static ModelProtocolRequest request(
            InvocationBinding binding,
            boolean streaming,
            ResponseMode responseMode,
            String content
    ) {
        return new ModelProtocolRequest(
                binding,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, content)),
                responseMode,
                streaming,
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2),
                        Duration.ofSeconds(3)
                )
        );
    }
}
