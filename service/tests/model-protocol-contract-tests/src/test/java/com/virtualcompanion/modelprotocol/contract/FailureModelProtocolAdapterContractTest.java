package com.virtualcompanion.modelprotocol.contract;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelfailure.FailureModelProtocolAdapter;
import com.virtualcompanion.modelfailure.FailureScenario;
import com.virtualcompanion.modelfailure.FailureScript;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.guard.ModelProtocolEventFence;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.binding;
import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.drain;
import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.ownership;
import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.structuredRequest;
import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.textRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FailureModelProtocolAdapterContractTest {

    @Test
    void normalized_429_mapping_baseline() {
        assertInstanceOf(
                AdapterFailure.RateLimited.class,
                onlyFailure(FailureScenario.HTTP_429)
        );
    }

    @Test
    void normalized_5xx_mapping_baseline() {
        assertInstanceOf(
                AdapterFailure.UpstreamUnavailable.class,
                onlyFailure(FailureScenario.HTTP_5XX)
        );
    }

    @Test
    void connect_timeout_occurs_before_any_delta() {
        var events = failureEvents(FailureScenario.CONNECT_TIMEOUT);

        assertEquals(1, events.size());
        assertEquals(
                AdapterFailure.TimeoutPhase.CONNECT,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        failure(events.getFirst())
                ).phase()
        );
    }

    @Test
    void first_token_timeout_occurs_before_any_delta() {
        var events = failureEvents(FailureScenario.FIRST_TOKEN_TIMEOUT);

        assertEquals(1, events.size());
        assertEquals(
                AdapterFailure.TimeoutPhase.FIRST_TOKEN,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        failure(events.getFirst())
                ).phase()
        );
    }

    @Test
    void total_timeout_preserves_only_its_own_prefix_and_has_no_eos() {
        var adapter = new FailureModelProtocolAdapter(FailureScript.withTextPrefix(
                FailureScenario.TOTAL_TIMEOUT,
                List.of("partial-", "same-attempt")
        ));
        var events = drain(adapter.open(
                textRequest(binding(), true, "total timeout")
        ));

        assertEquals(3, events.size());
        assertEquals("partial-", text(events.get(0)));
        assertEquals("same-attempt", text(events.get(1)));
        assertEquals(
                AdapterFailure.TimeoutPhase.TOTAL,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        failure(events.getLast())
                ).phase()
        );
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
    }

    @Test
    void malformed_event_fails_closed_without_raw_provider_exception() {
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                onlyFailure(FailureScenario.MALFORMED_EVENT)
        );
    }

    @Test
    void disconnect_after_prefix_never_emits_success_eos() {
        var adapter = new FailureModelProtocolAdapter(FailureScript.withTextPrefix(
                FailureScenario.DISCONNECT,
                List.of("partial")
        ));
        var events = drain(adapter.open(
                textRequest(binding(), true, "disconnect")
        ));

        assertEquals("partial", text(events.getFirst()));
        assertInstanceOf(AdapterFailure.Disconnected.class, failure(events.getLast()));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
    }

    @Test
    void cancellation_failure_is_deterministic_and_idempotent() {
        var session = new FailureModelProtocolAdapter(
                FailureScenario.CANCELLATION_FAILED
        ).open(textRequest(binding(), true, "cancel"));

        assertTrue(session.next().isEmpty(), "scenario waits for a cancellation request");
        session.cancel();
        session.cancel();
        session.close();
        session.close();
        var events = drain(session);

        assertEquals(1, events.size());
        assertInstanceOf(
                AdapterFailure.CancellationFailed.class,
                failure(events.getFirst())
        );
    }

    @Test
    void late_delta_is_discarded_by_the_complete_binding_fence() {
        var expected = binding();
        var events = drain(new FailureModelProtocolAdapter(
                FailureScenario.LATE_DELTA
        ).open(textRequest(expected, true, "late")));

        var late = assertInstanceOf(
                ModelProtocolEvent.OutputDelta.class,
                events.getFirst()
        );
        assertTrue(ModelProtocolEventFence.accept(expected, late).isEmpty());
        assertEquals(expected, events.getLast().binding());
        assertInstanceOf(AdapterFailure.Disconnected.class, failure(events.getLast()));
    }

    @Test
    void full_binding_fence_rejects_each_ownership_source_and_fence_mismatch() {
        var expected = binding();
        var event = new ModelProtocolEvent.OutputDelta(
                expected,
                0,
                new ModelPayload.TextChunk("delta")
        );
        var mismatches = List.of(
                binding(ownership("owner-2", "relationship-1", "conversation-1", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-2", "conversation-1", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-2", "generation-1"),
                        "source-1", 7),
                binding(ownership("owner-1", "relationship-1", "conversation-1", "generation-2"),
                        "source-1", 7),
                binding(ownership(), "source-2", 7),
                binding(ownership(), "source-1", 8)
        );

        assertTrue(ModelProtocolEventFence.accept(expected, event).isPresent());
        mismatches.forEach(mismatch ->
                assertTrue(ModelProtocolEventFence.accept(mismatch, event).isEmpty())
        );
    }

    @Test
    void external_attempt_binding_is_rejected_as_a_deterministic_source_violation() {
        var external = new InvocationBinding.ExternalAttemptBinding(
                ownership(),
                "provider-attempt-1",
                7,
                "requested-auth-1",
                "execution-auth-1"
        );
        var events = drain(new FailureModelProtocolAdapter(
                FailureScenario.HTTP_429
        ).open(textRequest(external, true, "external")));

        assertInstanceOf(
                AdapterFailure.UnsupportedBinding.class,
                failure(events.getFirst())
        );
    }

    @Test
    void structured_output_is_rejected_when_not_claimed() {
        var events = drain(new FailureModelProtocolAdapter(
                FailureScenario.HTTP_429
        ).open(structuredRequest(binding(), true, "structured")));

        assertInstanceOf(
                AdapterFailure.UnsupportedCapability.class,
                failure(events.getFirst())
        );
    }

    @Test
    void same_failure_script_and_request_are_value_deterministic() {
        var adapter = new FailureModelProtocolAdapter(FailureScript.withTextPrefix(
                FailureScenario.DISCONNECT,
                List.of("a", "b")
        ));
        var request = textRequest(binding(), true, "same");

        assertEquals(
                drain(adapter.open(request)),
                drain(adapter.open(request))
        );
    }

    @Test
    void failure_protocol_is_the_generated_catalog_value() {
        assertEquals(
                ModelProtocol.FAILURE,
                new FailureModelProtocolAdapter(FailureScenario.HTTP_429).protocol()
        );
    }

    private static AdapterFailure onlyFailure(FailureScenario scenario) {
        var events = failureEvents(scenario);
        assertEquals(1, events.size());
        return failure(events.getFirst());
    }

    private static List<ModelProtocolEvent> failureEvents(FailureScenario scenario) {
        return drain(new FailureModelProtocolAdapter(scenario).open(
                textRequest(binding(), true, scenario.name())
        ));
    }

    private static AdapterFailure failure(ModelProtocolEvent event) {
        return assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                event
        ).failure();
    }

    private static String text(ModelProtocolEvent event) {
        return assertInstanceOf(
                ModelPayload.TextChunk.class,
                assertInstanceOf(
                        ModelProtocolEvent.OutputDelta.class,
                        event
                ).payload()
        ).text();
    }
}
