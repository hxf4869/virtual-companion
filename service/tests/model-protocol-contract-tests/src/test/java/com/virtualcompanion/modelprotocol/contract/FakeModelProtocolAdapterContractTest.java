package com.virtualcompanion.modelprotocol.contract;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelfake.FakeModelProtocolAdapter;
import com.virtualcompanion.modelfake.FakeResponseScript;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
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

class FakeModelProtocolAdapterContractTest {

    private static final TokenUsage USAGE = new TokenUsage(12, 7, 19);

    @Test
    void non_stream_success() {
        var adapter = textAdapter(List.of("你好", "，世界🙂"), StopReason.STOP);
        var events = drain(adapter.open(
                textRequest(binding(), false, "请回复")
        ));

        assertEquals(ModelProtocol.FAKE, adapter.protocol());
        assertEquals(3, events.size());
        assertEquals(
                new ModelPayload.TextChunk("你好，世界🙂"),
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.get(0)).payload()
        );
        assertEquals(
                USAGE,
                assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1)).usage()
        );
        assertEquals(
                StopReason.STOP,
                assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.get(2)).stopReason()
        );
    }

    @Test
    void normalized_stream_success_is_ordered_but_does_not_claim_sse_framing() {
        var adapter = textAdapter(List.of("第一段", " / ", "第二段"), StopReason.LENGTH);
        var events = drain(adapter.open(
                textRequest(binding(), true, "流式回复")
        ));

        assertEquals(
                List.of("第一段", " / ", "第二段"),
                events.stream()
                        .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                        .map(ModelProtocolEvent.OutputDelta.class::cast)
                        .map(ModelProtocolEvent.OutputDelta::payload)
                        .map(ModelPayload.TextChunk.class::cast)
                        .map(ModelPayload.TextChunk::text)
                        .toList()
        );
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(3));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.get(4));
    }

    @Test
    void unicode_and_long_text() {
        var unicode = "陪伴🙂e\u0301汉字";
        var longText = unicode.repeat(8_192);
        var adapter = textAdapter(
                List.of(longText.substring(0, longText.length() / 2),
                        longText.substring(longText.length() / 2)),
                StopReason.STOP
        );

        var nonStreaming = drain(adapter.open(
                textRequest(binding(), false, "长文本")
        ));
        var streaming = drain(adapter.open(
                textRequest(binding(), true, "长文本")
        ));

        assertEquals(longText, joinedText(nonStreaming));
        assertEquals(longText, joinedText(streaming));
    }

    @Test
    void usage_mapping() {
        var events = drain(textAdapter(List.of("ok"), StopReason.STOP).open(
                textRequest(binding(), false, "usage")
        ));

        var usage = events.stream()
                .filter(ModelProtocolEvent.UsageReported.class::isInstance)
                .map(ModelProtocolEvent.UsageReported.class::cast)
                .findFirst()
                .orElseThrow()
                .usage();
        assertEquals(12, usage.inputTokens());
        assertEquals(7, usage.outputTokens());
        assertEquals(19, usage.totalTokens());
    }

    @Test
    void finish_or_stop_reason_mapping() {
        var events = drain(textAdapter(List.of("trimmed"), StopReason.LENGTH).open(
                textRequest(binding(), false, "stop reason")
        ));

        assertEquals(
                StopReason.LENGTH,
                assertInstanceOf(
                        ModelProtocolEvent.AttemptEos.class,
                        events.getLast()
                ).stopReason()
        );
    }

    @Test
    void structured_output_when_claimed() {
        var json = "{\"answer\":\"今晚辛苦了\"}";
        var adapter = new FakeModelProtocolAdapter(FakeResponseScript.structured(
                List.of("unused-for-structured"),
                USAGE,
                StopReason.STOP,
                json
        ));

        var events = drain(adapter.open(
                structuredRequest(binding(), false, "结构化回复")
        ));

        assertTrue(adapter.capabilities().supports(
                ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
        ));
        assertEquals(
                new ModelPayload.StructuredJson(json),
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.get(0)).payload()
        );
    }

    @Test
    void structured_output_is_rejected_when_not_claimed() {
        var adapter = textAdapter(List.of("text-only"), StopReason.STOP);

        var events = drain(adapter.open(
                structuredRequest(binding(), false, "结构化回复")
        ));

        var failure = assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getFirst()
        ).failure();
        assertInstanceOf(AdapterFailure.UnsupportedCapability.class, failure);
    }

    @Test
    void cancellation_is_idempotent_and_terminal() {
        var session = textAdapter(List.of("first", "second"), StopReason.STOP).open(
                textRequest(binding(), true, "cancel")
        );

        assertInstanceOf(ModelProtocolEvent.OutputDelta.class, session.next().orElseThrow());
        session.cancel();
        session.cancel();
        session.close();
        session.close();

        var cancelled = assertInstanceOf(
                ModelProtocolEvent.AttemptCancelled.class,
                session.next().orElseThrow()
        );
        assertEquals(1, cancelled.sequence());
        assertTrue(session.next().isEmpty());
    }

    @Test
    void external_attempt_binding_is_rejected_without_invocation() {
        var external = new InvocationBinding.ExternalAttemptBinding(
                ownership(),
                "provider-attempt-1",
                7,
                "requested-auth-1",
                "execution-auth-1"
        );
        var adapter = textAdapter(List.of("must-not-emit"), StopReason.STOP);

        var events = drain(adapter.open(
                textRequest(external, false, "external")
        ));

        assertInstanceOf(
                AdapterFailure.UnsupportedBinding.class,
                assertInstanceOf(
                        ModelProtocolEvent.AttemptFailed.class,
                        events.getFirst()
                ).failure()
        );
    }

    @Test
    void same_script_and_request_are_value_deterministic() {
        var adapter = textAdapter(List.of("固定", "结果"), StopReason.STOP);
        var request = textRequest(binding(), true, "same");

        assertEquals(
                drain(adapter.open(request)),
                drain(adapter.open(request))
        );
    }

    @Test
    void outputs_from_different_bindings_are_never_stitched() {
        var first = new FakeModelProtocolAdapter(FakeResponseScript.text(
                List.of("attempt-a-prefix"),
                USAGE,
                StopReason.STOP
        ));
        var second = new FakeModelProtocolAdapter(FakeResponseScript.text(
                List.of("attempt-b-complete"),
                USAGE,
                StopReason.STOP
        ));
        var firstBinding = binding(ownership(), "source-a", 1);
        var secondBinding = binding(ownership(), "source-b", 2);

        var firstText = joinedText(drain(first.open(
                textRequest(firstBinding, false, "first")
        )));
        var secondText = joinedText(drain(second.open(
                textRequest(secondBinding, false, "second")
        )));

        assertEquals("attempt-a-prefix", firstText);
        assertEquals("attempt-b-complete", secondText);
    }

    private static FakeModelProtocolAdapter textAdapter(
            List<String> chunks,
            StopReason stopReason
    ) {
        return new FakeModelProtocolAdapter(FakeResponseScript.text(
                chunks,
                USAGE,
                stopReason
        ));
    }

    private static String joinedText(List<ModelProtocolEvent> events) {
        return events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .map(ModelProtocolEvent.OutputDelta::payload)
                .filter(ModelPayload.TextChunk.class::isInstance)
                .map(ModelPayload.TextChunk.class::cast)
                .map(ModelPayload.TextChunk::text)
                .collect(java.util.stream.Collectors.joining());
    }
}
