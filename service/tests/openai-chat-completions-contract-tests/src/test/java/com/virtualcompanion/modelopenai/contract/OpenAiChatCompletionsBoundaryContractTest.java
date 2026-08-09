package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelopenai.OpenAiChatCompletionsAdapter;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsConfig;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.MODEL;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.REQUESTED_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.TOKEN;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.binding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.deterministicBinding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.drain;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.invalidStructuredRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.normalBudgets;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sseCrLf;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.structuredRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsBoundaryContractTest {

    @Test
    void oversizedMessageAndSchemaFailBeforeNetwork() {
        var client = new NeverCompletingHttpClient();
        var adapter = adapter(client, URI.create("http://127.0.0.1:9/v1/chat/completions"));

        assertThrows(
                IllegalArgumentException.class,
                () -> adapter.open(new ModelProtocolRequest(
                        binding(),
                        List.of(new ProtocolMessage(
                                ProtocolMessage.Role.USER,
                                "m".repeat(SizeLimits.MAX_MESSAGE_BYTES + 1)
                        )),
                        new ResponseMode.Text(),
                        false,
                        normalBudgets()
                ))
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> adapter.open(new ModelProtocolRequest(
                        binding(),
                        java.util.Collections.nCopies(
                                SizeLimits.MAX_MESSAGES + 1,
                                new ProtocolMessage(ProtocolMessage.Role.USER, "hello")
                        ),
                        new ResponseMode.Text(),
                        false,
                        normalBudgets()
                ))
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> adapter.open(new ModelProtocolRequest(
                        binding(),
                        List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hello")),
                        new ResponseMode.StructuredJson(
                                "oversized",
                                "s".repeat(SizeLimits.MAX_SCHEMA_BYTES + 1)
                        ),
                        false,
                        normalBudgets()
                ))
        );

        assertEquals(0, client.calls());
    }

    @Test
    void exactRequestSizeLimitsRemainValid() {
        var request = new ModelProtocolRequest(
                binding(),
                java.util.Collections.nCopies(
                        SizeLimits.MAX_MESSAGES,
                        new ProtocolMessage(ProtocolMessage.Role.USER, "hello")
                ),
                new ResponseMode.StructuredJson(
                        "exact",
                        "s".repeat(SizeLimits.MAX_SCHEMA_BYTES)
                ),
                false,
                normalBudgets()
        );

        assertEquals(SizeLimits.MAX_MESSAGES, request.messages().size());
        assertEquals(
                SizeLimits.MAX_SCHEMA_BYTES,
                SizeLimits.utf8Bytes(
                        ((ResponseMode.StructuredJson) request.responseMode()).jsonSchema()
                )
        );
        assertEquals(
                SizeLimits.MAX_MESSAGE_BYTES,
                SizeLimits.utf8Bytes(new ProtocolMessage(
                        ProtocolMessage.Role.USER,
                        "🙂".repeat(SizeLimits.MAX_MESSAGE_BYTES / 4)
                ).content())
        );
    }

    @Test
    void streamingSingleDataPayloadOneOverStopsEarlyAndFailsClosed() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        byte[] oversizedEvent = ("data: " + " ".repeat(limit + 1) + "\n\n")
                .getBytes(StandardCharsets.UTF_8);
        long offendingByte = "data: ".length() + limit + 1L;
        var body = new TrackingInputStream(oversizedEvent, offendingByte);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertEquals(offendingByte, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void streamingCumulativeOutputOverLimitFailsClosed() throws Exception {
        int firstBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES / 2;
        var stream = sse(choiceChunk("a".repeat(firstBytes), null))
                + sse(choiceChunk("b".repeat(firstBytes + 1), null))
                + "must-not-be-read";
        byte[] response = stream.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < response.length);
        body.awaitClosed();
    }

    @Test
    void streamingTextSplitPairAtExactOutputLimitSucceeds() throws Exception {
        int limit = SizeLimits.MAX_TOTAL_OUTPUT_BYTES;
        int firstAscii = limit / 3;
        int secondAscii = limit / 3;
        int thirdAscii = limit - firstAscii - secondAscii - 4;
        String first = "a".repeat(firstAscii);
        String second = "b".repeat(secondAscii) + "\uD83D";
        String third = "\uDE42" + "c".repeat(thirdAscii);
        String response = sse(choiceChunkWithJsonEncodedContent(first))
                + sse(choiceChunkWithJsonEncodedContent(
                        "b".repeat(secondAscii) + "\\uD83D"))
                + sse(choiceChunkWithJsonEncodedContent(
                        "\\uDE42" + "c".repeat(thirdAscii)))
                + sse(choiceChunk(null, "stop"))
                + sse(usageChunk(1, 1))
                + done();
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longBudgetRequest(true)));

        assertSuccessfulText(events, first + second + third);
        body.awaitClosed();
    }

    @Test
    void streamingTextSplitPairOneOverFailsBeforeOffendingDelta() throws Exception {
        int limit = SizeLimits.MAX_TOTAL_OUTPUT_BYTES;
        int firstAscii = limit / 3;
        int secondAscii = limit / 3;
        int thirdAscii = limit - firstAscii - secondAscii - 4 + 1;
        String first = "a".repeat(firstAscii);
        String second = "b".repeat(secondAscii) + "\uD83D";
        String third = "\uDE42" + "c".repeat(thirdAscii);
        String response = sse(choiceChunkWithJsonEncodedContent(first))
                + sse(choiceChunkWithJsonEncodedContent(
                        "b".repeat(secondAscii) + "\\uD83D"))
                + sse(choiceChunkWithJsonEncodedContent(
                        "\\uDE42" + "c".repeat(thirdAscii)))
                + "must-not-be-read";
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longBudgetRequest(true)));

        assertMalformedFailure(events.getLast());
        assertEquals(List.of(first, second), textDeltas(events));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < responseBytes.length);
        body.awaitClosed();
    }

    @Test
    void streamingStructuredSplitPairAtExactOutputLimitSucceeds() throws Exception {
        int limit = SizeLimits.MAX_TOTAL_OUTPUT_BYTES;
        String prefix = "{\"value\":\"";
        String suffix = "\"}";
        int asciiBytes = (int) (limit
                - SizeLimits.utf8Bytes(prefix)
                - SizeLimits.utf8Bytes(suffix)
                - 4);
        int firstAscii = asciiBytes / 2;
        int secondAscii = asciiBytes - firstAscii;
        String first = prefix + "a".repeat(firstAscii);
        String second = "b".repeat(secondAscii) + "\uD83D";
        String third = "\uDE42" + suffix;
        String response = sse(choiceChunkWithJsonEncodedContent(
                        "{\\\"value\\\":\\\"" + "a".repeat(firstAscii)))
                + sse(choiceChunkWithJsonEncodedContent(
                        "b".repeat(secondAscii) + "\\uD83D"))
                + sse(choiceChunkWithJsonEncodedContent("\\uDE42\\\"}"))
                + sse(choiceChunk(null, "stop"))
                + sse(usageChunk(1, 1))
                + done();
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(structuredRequest(true, "split structured exact")));

        assertSuccessfulStructured(events, first + second + third);
        body.awaitClosed();
    }

    @Test
    void streamingStructuredSplitPairOneOverFailsBeforeAppendingSuccess() throws Exception {
        int limit = SizeLimits.MAX_TOTAL_OUTPUT_BYTES;
        String prefix = "{\"value\":\"";
        String suffix = "\"}";
        int asciiBytes = (int) (limit
                - SizeLimits.utf8Bytes(prefix)
                - SizeLimits.utf8Bytes(suffix)
                - 4);
        int firstAscii = asciiBytes / 2;
        int secondAscii = asciiBytes - firstAscii;
        String first = prefix + "a".repeat(firstAscii);
        String second = "b".repeat(secondAscii) + "\uD83D";
        String third = "\uDE42" + suffix + "x";
        String response = sse(choiceChunkWithJsonEncodedContent(
                        "{\\\"value\\\":\\\"" + "a".repeat(firstAscii)))
                + sse(choiceChunkWithJsonEncodedContent(
                        "b".repeat(secondAscii) + "\\uD83D"))
                + sse(choiceChunkWithJsonEncodedContent("\\uDE42\\\"}x"))
                + "must-not-be-read";
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(structuredRequest(true, "split structured over")));

        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < responseBytes.length);
        body.awaitClosed();
    }

    @Test
    void nonStreamingOutputOverLimitFailsClosed() throws Exception {
        byte[] response = OpenAiContractTestSupport.completion(
                "x".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES + 1),
                "stop",
                1,
                1
        ).getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("application/json", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals(response.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void nonStreamingRawBodyExactLimitRemainsValidAndClosesBody() throws Exception {
        byte[] response = paddedCompletionBody(SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("application/json", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(false)));

        assertSuccessfulText(events, "bounded");
        assertEquals(response.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void nonStreamingRawBodyOneOverStopsAtProbeAndFailsMalformed() throws Exception {
        int limit = SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES;
        byte[] response = paddedCompletionBody(limit + 4096);
        var body = new TrackingInputStream(response, limit + 1L, limit);
        var client = new StaticInputHttpClient("application/json", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertEquals(limit + 1L, body.bytesRead());
        assertFalse(body.bulkReadRequestedPastFence());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        body.awaitClosed();
    }

    @Test
    void oversizedSseCommentStopsAtFirstOverLimitByteAndClosesBody() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        byte[] response = (":" + "x".repeat(limit) + "\n\n")
                .getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, limit + 1L);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertEquals(limit + 1L, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void multilineSseEventStopsOnTheByteThatExceedsCombinedLimit() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        int firstValueBytes = limit / 2;
        int secondValueBytes = limit - firstValueBytes;
        assertEquals(limit + 1, firstValueBytes + 1 + secondValueBytes);
        String response = "data: " + " ".repeat(firstValueBytes) + "\n"
                + "data: " + " ".repeat(secondValueBytes) + "\n\n"
                + "must-not-be-read";
        long offendingByte = "data: ".length() + firstValueBytes + 1L
                + "data: ".length() + secondValueBytes;
        var body = new TrackingInputStream(
                response.getBytes(StandardCharsets.UTF_8),
                offendingByte
        );
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertEquals(offendingByte, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void exactCombinedSseDataLimitRemainsValidWithMultilineCrLf() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = choiceChunk("exact-event", null);
        int firstValueBytes = limit / 2;
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        int secondPaddingBytes = limit - firstValueBytes - 1 - chunkBytes;
        assertEquals(limit, firstValueBytes + 1 + secondPaddingBytes + chunkBytes);
        String response = "data: " + " ".repeat(firstValueBytes) + "\r\n"
                + "data: " + " ".repeat(secondPaddingBytes) + chunk + "\r\n\r\n"
                + sseCrLf(choiceChunk(null, "stop"))
                + sseCrLf(usageChunk(1, 1))
                + "data: [DONE]\r\n\r\n";
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertSuccessfulText(events, "exact-event");
        assertTrue(body.bytesRead() <= responseBytes.length);
        body.awaitClosed();
    }

    @Test
    void exactSingleLineSseDataPayloadLimitRemainsValid() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = choiceChunk("exact-single-line", null);
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        String response = "data: " + " ".repeat(limit - chunkBytes) + chunk + "\n\n"
                + sse(choiceChunk(null, "stop"))
                + sse(usageChunk(1, 1))
                + "data: [DONE]\n\n";
        byte[] responseBytes = response.getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(responseBytes, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertSuccessfulText(events, "exact-single-line");
        assertTrue(body.bytesRead() <= responseBytes.length);
        body.awaitClosed();
    }

    @Test
    void nonBmpSseDataAtExactLimitRemainsValid() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = choiceChunk("🙂", null);
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        String data = " ".repeat(limit - chunkBytes) + chunk;
        assertEquals(limit, data.getBytes(StandardCharsets.UTF_8).length);
        byte[] response = concat(
                ("data: " + data + "\n\n").getBytes(StandardCharsets.UTF_8),
                sse(choiceChunk(null, "stop")).getBytes(StandardCharsets.UTF_8),
                sse(usageChunk(1, 1)).getBytes(StandardCharsets.UTF_8),
                done().getBytes(StandardCharsets.UTF_8)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertSuccessfulText(events, "🙂");
        body.awaitClosed();
    }

    @Test
    void nonBmpSseDataOneOverFailsBeforeDispatchingAnyEvent() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = choiceChunk("🙂", null);
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        String data = " ".repeat(limit - chunkBytes) + chunk + " ";
        assertEquals(limit + 1, data.getBytes(StandardCharsets.UTF_8).length);
        byte[] response = ("data: " + data + "\n\n")
                .getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals("data: ".length() + limit + 1L, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void nonBmpNonStreamingRawBodyExactLimitRemainsValid() throws Exception {
        byte[] response = paddedCompletionBodyWithNonBmp(
                SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);
        var client = new StaticInputHttpClient("application/json", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(false)));

        assertSuccessfulText(events, "🙂");
        assertEquals(response.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void nonBmpNonStreamingRawBodyOneOverFailsWithoutTerminalSuccess() throws Exception {
        int limit = SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES;
        byte[] response = paddedCompletionBodyWithNonBmp(limit + 1);
        var body = new TrackingInputStream(response, limit + 1L, limit);
        var client = new StaticInputHttpClient("application/json", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals(limit + 1L, body.bytesRead());
        assertFalse(body.bulkReadRequestedPastFence());
        body.awaitClosed();
    }

    @Test
    void invalidUtf8SseEventFailsBeforeDispatchingThatEvent() throws Exception {
        byte[] valid = sse(choiceChunk("before-invalid", null))
                .getBytes(StandardCharsets.UTF_8);
        String invalidChunk = choiceChunk("replace-me", null);
        int marker = invalidChunk.indexOf("replace-me");
        byte[] invalid = concat(
                ("data: " + invalidChunk.substring(0, marker))
                        .getBytes(StandardCharsets.UTF_8),
                new byte[]{(byte) 0xc3, (byte) 0x28},
                (invalidChunk.substring(marker + "replace-me".length()) + "\n\n")
                        .getBytes(StandardCharsets.UTF_8)
        );
        var body = new TrackingInputStream(concat(valid, invalid), Long.MAX_VALUE);
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertEquals(List.of("before-invalid"), events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .map(ModelProtocolEvent.OutputDelta::payload)
                .map(ModelPayload.TextChunk.class::cast)
                .map(ModelPayload.TextChunk::text)
                .toList());
        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        body.awaitClosed();
    }

    @Test
    void explicitCancellationClosesStreamingResponseBody() throws Exception {
        var body = new BlockingAfterDataInputStream(
                sse(choiceChunk("before-cancel", null)).getBytes(StandardCharsets.UTF_8)
        );
        var client = new StaticInputHttpClient("text/event-stream", body);
        var session = adapter(client, offlineEndpoint()).open(longBudgetRequest(true));

        var first = assertInstanceOf(
                ModelProtocolEvent.OutputDelta.class,
                session.next().orElseThrow()
        );
        assertEquals(
                "before-cancel",
                assertInstanceOf(ModelPayload.TextChunk.class, first.payload()).text()
        );
        body.awaitWaitingForMoreData();

        session.cancel();

        assertInstanceOf(ModelProtocolEvent.AttemptCancelled.class, session.next().orElseThrow());
        assertTrue(session.next().isEmpty());
        body.awaitClosed();
        session.close();
    }

    @Test
    void bareCarriageReturnSseFramingRemainsValid() throws Exception {
        String response = "data: " + choiceChunk("cr-only", null) + "\r\r"
                + "data: " + choiceChunk(null, "stop") + "\r\r"
                + "data: " + usageChunk(1, 1) + "\r\r"
                + "data: [DONE]\r\r";
        var body = new TrackingInputStream(
                response.getBytes(StandardCharsets.UTF_8),
                Long.MAX_VALUE
        );
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertSuccessfulText(events, "cr-only");
        body.awaitClosed();
    }

    @Test
    void emptyDataEventRetainsMalformedFailureSemantics() throws Exception {
        var body = new TrackingInputStream(
                "data:\n\n".getBytes(StandardCharsets.UTF_8),
                Long.MAX_VALUE
        );
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        assertMalformedFailure(events.getFirst());
        body.awaitClosed();
    }

    @Test
    void finalDataLineWithoutBlankSeparatorIsDispatchedAtEof() throws Exception {
        String response = "data: " + choiceChunk("eof-data", null);
        var body = new TrackingInputStream(
                response.getBytes(StandardCharsets.UTF_8),
                Long.MAX_VALUE
        );
        var client = new StaticInputHttpClient("text/event-stream", body);

        var events = drain(adapter(client, offlineEndpoint())
                .open(longBudgetRequest(true)));

        var delta = assertInstanceOf(
                ModelProtocolEvent.OutputDelta.class,
                events.getFirst()
        );
        assertEquals("eof-data", assertInstanceOf(ModelPayload.TextChunk.class, delta.payload()).text());
        assertMalformedFailure(events.getLast());
        body.awaitClosed();
    }

    @Test
    void deterministic_binding_and_invalid_schema_make_zero_network_calls() {
        var client = new NeverCompletingHttpClient();
        var endpoint = URI.create("http://127.0.0.1:9/v1/chat/completions");
        var adapter = adapter(client, endpoint);

        var deterministicSession = adapter.open(textRequest(
                deterministicBinding(),
                false,
                "must not leave process",
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2)
                )
        ));
        var deterministicFailure = assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                deterministicSession.next().orElseThrow()
        );
        assertEquals(deterministicBinding(), deterministicFailure.binding());
        assertInstanceOf(
                AdapterFailure.UnsupportedBinding.class,
                deterministicFailure.failure()
        );
        assertTrue(deterministicSession.next().isEmpty());

        var invalidSchema = drain(adapter.open(invalidStructuredRequest()));
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                assertInstanceOf(
                        ModelProtocolEvent.AttemptFailed.class,
                        invalidSchema.getFirst()
                ).failure()
        );
        assertEquals(0, client.calls());
    }

    @Test
    void config_rejects_non_contract_endpoints_and_header_injection() {
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("ftp://127.0.0.1/v1/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        var validConfig = new OpenAiChatCompletionsConfig(
                URI.create("http://127.0.0.1/v1/chat/completions"),
                TOKEN,
                MODEL
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsAdapter(
                        HttpClient.newBuilder()
                                .followRedirects(HttpClient.Redirect.ALWAYS)
                                .build(),
                        validConfig
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/responses"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/%76%31/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://user@127.0.0.1/v1/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions?key=value"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions"),
                        TOKEN + "\r\nInjected: value",
                        MODEL
                )
        );
    }

    @Test
    void config_rejects_endpoints_outside_the_egress_allowlist() {
        var openai = URI.create("https://api.openai.com/v1/chat/completions");
        var validConfig = new OpenAiChatCompletionsConfig(openai, TOKEN, MODEL);
        assertEquals(openai, validConfig.endpoint());
        var uppercaseOpenAi = URI.create("https://API.OPENAI.COM/v1/chat/completions");
        assertEquals(
                uppercaseOpenAi,
                new OpenAiChatCompletionsConfig(uppercaseOpenAi, TOKEN, MODEL).endpoint());

        assertRejected("http://api.openai.com/v1/chat/completions");
        assertRejected("https://evil.example.com/v1/chat/completions");
        assertRejected("https://EVIL.EXAMPLE.COM/v1/chat/completions");
        assertRejected("https://api.openai.com:8443/v1/chat/completions");
        assertRejected("https://192.168.1.5/v1/chat/completions");
        assertRejected("https://10.0.0.1/v1/chat/completions");
        assertRejected("https://172.16.0.1/v1/chat/completions");
        assertRejected("https://169.254.169.254/v1/chat/completions");
        assertRejected("https://100.100.100.200/v1/chat/completions");
        assertRejected("https://127.0.0.2/v1/chat/completions");
        assertRejected("https://8.8.8.8/v1/chat/completions");
        assertRejected("https://[::1]/v1/chat/completions");
    }

    private void assertRejected(String endpoint) {
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(URI.create(endpoint), TOKEN, MODEL));
    }

    @Test
    void config_rejects_unicode_header_token_without_leak_or_network() {
        var invalidToken = "synthetic-token-密钥-🙂";
        var client = new NeverCompletingHttpClient();

        var failure = assertThrows(
                IllegalArgumentException.class,
                () -> {
                    var config = new OpenAiChatCompletionsConfig(
                            URI.create("http://127.0.0.1:9/v1/chat/completions"),
                            invalidToken,
                            MODEL
                    );
                    new OpenAiChatCompletionsAdapter(client, config)
                            .open(textRequest(false, "must stay offline"));
                }
        );

        assertFalse(failure.toString().contains(invalidToken));
        assertFalse(failure.toString().contains("密钥"));
        assertEquals(0, client.calls());
    }

    @Test
    void new_type_string_representations_are_secret_and_body_free() {
        var endpoint = URI.create("http://127.0.0.1:9/v1/chat/completions");
        var config = new OpenAiChatCompletionsConfig(endpoint, TOKEN, MODEL);
        var client = new NeverCompletingHttpClient();
        var adapter = new OpenAiChatCompletionsAdapter(client, config);
        var session = adapter.open(textRequest(
                binding(),
                true,
                "body-sentinel",
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2)
                )
        ));
        try {
            for (String value : List.of(
                    config.toString(),
                    adapter.toString(),
                    session.toString()
            )) {
                assertFalse(value.contains(TOKEN));
                assertFalse(value.contains("body-sentinel"));
                assertFalse(value.contains(REQUESTED_AUTH));
                assertFalse(value.contains(EXECUTION_AUTH));
            }
        } finally {
            session.cancel();
        }
    }

    @Test
    void multiline_sse_data_is_decoded_as_one_json_event() throws Exception {
        var chunk = choiceChunk("multi-data", null);
        int split = chunk.indexOf(",\"choices\"");
        var multiline = "data: " + chunk.substring(0, split + 1) + "\n"
                + "data: " + chunk.substring(split + 1) + "\n\n";
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "text/event-stream",
                multiline
                        + sse(choiceChunk(null, "stop"))
                        + sse(usageChunk(1, 1))
                        + done()
        ))) {
            var events = drain(adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(true, "multi-line")));
            assertEquals(
                    "multi-data",
                    ((com.virtualcompanion.modelruntime.contract.ModelPayload.TextChunk)
                            assertInstanceOf(
                                    ModelProtocolEvent.OutputDelta.class,
                                    events.getFirst()
                            ).payload()).text()
            );
        }
    }

    @Test
    void streaming_rejects_json_content_type_without_parsing_body()
            throws Exception {
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json",
                "{\"object\":\"chat.completion.chunk\",\"choices\":[]}"
        ))) {
            var events = drain(adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(true, "wrong content type")));
            assertInstanceOf(
                    AdapterFailure.MalformedResponse.class,
                    assertInstanceOf(
                            ModelProtocolEvent.AttemptFailed.class,
                            events.getFirst()
                    ).failure()
            );
        }
    }

    @Test
    void adapter_has_no_default_real_endpoint_environment_or_runtime_wiring()
            throws Exception {
        assertTrue(List.of(OpenAiChatCompletionsAdapter.class.getConstructors()).stream()
                .allMatch(constructor -> List.of(constructor.getParameterTypes())
                        .contains(OpenAiChatCompletionsConfig.class)));

        var root = findRepositoryRoot();
        final String adapterSources;
        try (Stream<Path> sourcePaths = Files.walk(
                root.resolve("service/adapters/model-openai/src/main/java")
        )) {
            adapterSources = sourcePaths
                    .filter(Files::isRegularFile)
                    .map(path -> {
                        try {
                            return Files.readString(path);
                        } catch (Exception exception) {
                            throw new IllegalStateException(exception);
                        }
                    })
                    .reduce("", String::concat);
        }
        assertFalse(adapterSources.contains("api.openai.com"));
        assertFalse(adapterSources.contains("System.getenv"));
        assertFalse(adapterSources.contains("System.getProperty"));
        assertFalse(adapterSources.contains("org.slf4j"));
        assertFalse(adapterSources.contains("java.util.logging"));

        var runtimePom = Files.readString(
                root.resolve("service/apps/runtime/pom.xml")
        );
        // Approved live model suppliers are legitimate compile-time runtime
        // dependencies (TASK-0035). What the boundary must guarantee instead
        // is that providers stay disabled by default and that no default
        // endpoint or credential is ever committed.
        assertTrue(runtimePom.contains("virtual-companion-model-openai"));
        assertTrue(runtimePom.contains("virtual-companion-model-anthropic"));

        var runtimeConfig = Files.readString(
                root.resolve("service/apps/runtime/src/main/resources/application.yaml")
        );
        // The master switch defaults to disabled, and no provider endpoint,
        // secret literal or committed URL exists in runtime configuration.
        assertTrue(runtimeConfig.contains("${VC_MODEL_PROVIDERS_ENABLED:false}"));
        assertFalse(runtimeConfig.contains("api.openai.com"));
        assertFalse(runtimeConfig.contains("sk-"));

        // The provisioner wires a deployment only when its per-deployment
        // switch is true, and never hard-codes a scheme, endpoint or
        // credential: only approved runtime configuration can provision.
        var provisionerSources = Files.readString(
                root.resolve("service/apps/runtime/src/main/java/"
                        + "com/virtualcompanion/runtime/modelproviders/"
                        + "ApprovedModelProviderProvisioner.java")
        );
        assertTrue(provisionerSources.contains("if (!deployment.enabled())"));
        assertFalse(provisionerSources.contains("http://"));
        assertFalse(provisionerSources.contains("https://"));
        assertFalse(provisionerSources.contains("sk-"));
    }

    private static URI offlineEndpoint() {
        return URI.create("http://127.0.0.1:9/v1/chat/completions");
    }

    private static String choiceChunkWithJsonEncodedContent(String encodedContent) {
        return "{\"id\":\"chatcmpl-offline\","
                + "\"object\":\"chat.completion.chunk\","
                + "\"model\":\"" + MODEL + "\","
                + "\"choices\":[{\"index\":0,\"delta\":{\"content\":\""
                + encodedContent
                + "\"},\"finish_reason\":null}]}";
    }

    private static ModelProtocolRequest longBudgetRequest(boolean streaming) {
        return textRequest(
                binding(),
                streaming,
                "bounded response",
                new TimeoutBudget(
                        Duration.ofSeconds(5),
                        Duration.ofSeconds(10),
                        Duration.ofSeconds(30)
                )
        );
    }

    private static byte[] paddedCompletionBody(int targetBytes) {
        String completion = OpenAiContractTestSupport.completion(
                "bounded",
                "stop",
                1,
                1
        );
        String prefix = completion.substring(0, completion.length() - 1)
                + ",\"padding\":\"";
        String suffix = "\"}";
        int fixedBytes = prefix.getBytes(StandardCharsets.UTF_8).length
                + suffix.getBytes(StandardCharsets.UTF_8).length;
        if (targetBytes < fixedBytes) {
            throw new IllegalArgumentException("targetBytes is too small");
        }
        return (prefix + "p".repeat(targetBytes - fixedBytes) + suffix)
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] paddedCompletionBodyWithNonBmp(int targetBytes) {
        String completion = OpenAiContractTestSupport.completion(
                "🙂",
                "stop",
                1,
                1
        );
        String prefix = completion.substring(0, completion.length() - 1)
                + ",\"padding\":\"";
        String suffix = "\"}";
        int fixedBytes = prefix.getBytes(StandardCharsets.UTF_8).length
                + suffix.getBytes(StandardCharsets.UTF_8).length;
        int paddingBytes = targetBytes - fixedBytes;
        if (paddingBytes < 0) {
            throw new IllegalArgumentException("targetBytes is too small");
        }
        String padding = "🙂".repeat(paddingBytes / 4)
                + "p".repeat(paddingBytes % 4);
        byte[] result = (prefix + padding + suffix).getBytes(StandardCharsets.UTF_8);
        assertEquals(targetBytes, result.length);
        return result;
    }

    private static byte[] concat(byte[]... parts) {
        int length = 0;
        for (byte[] part : parts) {
            length += part.length;
        }
        byte[] result = new byte[length];
        int offset = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, result, offset, part.length);
            offset += part.length;
        }
        return result;
    }

    private static final class TrackingInputStream extends InputStream {

        private final byte[] data;
        private final long failAfterBytes;
        private final long bulkReadFence;
        private final CountDownLatch closed = new CountDownLatch(1);
        private volatile int position;
        private volatile boolean bulkReadRequestedPastFence;

        private TrackingInputStream(byte[] data, long failAfterBytes) {
            this(data, failAfterBytes, Long.MAX_VALUE);
        }

        private TrackingInputStream(
                byte[] data,
                long failAfterBytes,
                long bulkReadFence
        ) {
            this.data = Objects.requireNonNull(data, "data must not be null");
            this.failAfterBytes = failAfterBytes;
            this.bulkReadFence = bulkReadFence;
        }

        @Override
        public int read() {
            if (position >= data.length) {
                return -1;
            }
            requireWithinReadFence();
            return data[position++] & 0xff;
        }

        @Override
        public int read(byte[] bytes, int offset, int length) {
            Objects.checkFromIndexSize(offset, length, bytes.length);
            if (length == 0) {
                return 0;
            }
            if (position >= data.length) {
                return -1;
            }
            requireWithinReadFence();
            if (position + (long) length > bulkReadFence) {
                bulkReadRequestedPastFence = true;
            }
            int count = (int) Math.min(
                    Math.min((long) length, data.length - (long) position),
                    failAfterBytes - position
            );
            System.arraycopy(data, position, bytes, offset, count);
            position += count;
            return count;
        }

        @Override
        public void close() {
            closed.countDown();
        }

        private long bytesRead() {
            return position;
        }

        private boolean bulkReadRequestedPastFence() {
            return bulkReadRequestedPastFence;
        }

        private void awaitClosed() throws InterruptedException {
            assertTrue(closed.await(2, TimeUnit.SECONDS), "response body was not closed");
        }

        private void requireWithinReadFence() {
            if (position >= failAfterBytes) {
                throw new AssertionError("response parser read beyond the allowed fence");
            }
        }
    }

    private static final class BlockingAfterDataInputStream extends InputStream {

        private final byte[] data;
        private final CountDownLatch waitingForMoreData = new CountDownLatch(1);
        private final CountDownLatch closed = new CountDownLatch(1);
        private int position;
        private boolean isClosed;

        private BlockingAfterDataInputStream(byte[] data) {
            this.data = Objects.requireNonNull(data, "data must not be null");
        }

        @Override
        public int read() throws IOException {
            synchronized (this) {
                if (position < data.length) {
                    return data[position++] & 0xff;
                }
                waitingForMoreData.countDown();
                while (!isClosed) {
                    try {
                        wait();
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                        throw new IOException("interrupted while awaiting response data");
                    }
                }
                return -1;
            }
        }

        @Override
        public synchronized void close() {
            isClosed = true;
            closed.countDown();
            notifyAll();
        }

        private void awaitWaitingForMoreData() throws InterruptedException {
            assertTrue(
                    waitingForMoreData.await(2, TimeUnit.SECONDS),
                    "response parser did not wait for more data"
            );
        }

        private void awaitClosed() throws InterruptedException {
            assertTrue(closed.await(2, TimeUnit.SECONDS), "response body was not closed");
        }
    }

    private static final class StaticInputHttpClient extends HttpClient {

        private final String contentType;
        private final InputStream body;

        private StaticInputHttpClient(String contentType, InputStream body) {
            this.contentType = contentType;
            this.body = body;
        }

        @Override
        public Optional<CookieHandler> cookieHandler() {
            return Optional.empty();
        }

        @Override
        public Optional<Duration> connectTimeout() {
            return Optional.empty();
        }

        @Override
        public Redirect followRedirects() {
            return Redirect.NEVER;
        }

        @Override
        public Optional<ProxySelector> proxy() {
            return Optional.empty();
        }

        @Override
        public SSLContext sslContext() {
            try {
                return SSLContext.getDefault();
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public SSLParameters sslParameters() {
            return new SSLParameters();
        }

        @Override
        public Optional<Authenticator> authenticator() {
            return Optional.empty();
        }

        @Override
        public Version version() {
            return Version.HTTP_1_1;
        }

        @Override
        public Optional<Executor> executor() {
            return Optional.empty();
        }

        @Override
        public <T> HttpResponse<T> send(
                HttpRequest request,
                HttpResponse.BodyHandler<T> responseBodyHandler
        ) throws IOException {
            throw new AssertionError("adapter must use sendAsync");
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(
                HttpRequest request,
                HttpResponse.BodyHandler<T> responseBodyHandler
        ) {
            return CompletableFuture.completedFuture((HttpResponse<T>)
                    new StaticInputResponse(request, contentType, body));
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(
                HttpRequest request,
                HttpResponse.BodyHandler<T> responseBodyHandler,
                HttpResponse.PushPromiseHandler<T> pushPromiseHandler
        ) {
            return sendAsync(request, responseBodyHandler);
        }
    }

    private record StaticInputResponse(
            HttpRequest request,
            String contentType,
            InputStream body
    ) implements HttpResponse<InputStream> {

        @Override
        public int statusCode() {
            return 200;
        }

        @Override
        public Optional<HttpResponse<InputStream>> previousResponse() {
            return Optional.empty();
        }

        @Override
        public HttpHeaders headers() {
            return HttpHeaders.of(
                    Map.of("Content-Type", List.of(contentType)),
                    (name, value) -> true
            );
        }

        @Override
        public Optional<SSLSession> sslSession() {
            return Optional.empty();
        }

        @Override
        public URI uri() {
            return request.uri();
        }

        @Override
        public HttpClient.Version version() {
            return HttpClient.Version.HTTP_1_1;
        }
    }

    private static Path findRepositoryRoot() {
        var current = Path.of("").toAbsolutePath();
        while (current != null
                && (!Files.isRegularFile(current.resolve("pom.xml"))
                || !Files.isDirectory(current.resolve(".harness")))) {
            current = current.getParent();
        }
        if (current == null) {
            throw new IllegalStateException("repository root not found");
        }
        return current;
    }

    private static void assertSuccessfulText(
            List<ModelProtocolEvent> events,
            String expectedText
    ) {
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptFailed.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptCancelled.class::isInstance));
        assertEquals(
                1L,
                events.stream().filter(ModelProtocolEvent.UsageReported.class::isInstance).count()
        );
        var eos = assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertEquals(StopReason.STOP, eos.stopReason());

        var output = new StringBuilder();
        for (ModelProtocolEvent event : events) {
            if (event instanceof ModelProtocolEvent.OutputDelta delta) {
                output.append(assertInstanceOf(ModelPayload.TextChunk.class, delta.payload()).text());
            }
        }
        assertEquals(expectedText, output.toString());
    }

    private static List<String> textDeltas(List<ModelProtocolEvent> events) {
        return events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .map(ModelProtocolEvent.OutputDelta::payload)
                .filter(ModelPayload.TextChunk.class::isInstance)
                .map(ModelPayload.TextChunk.class::cast)
                .map(ModelPayload.TextChunk::text)
                .toList();
    }

    private static void assertSuccessfulStructured(
            List<ModelProtocolEvent> events,
            String expectedJson
    ) {
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptFailed.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptCancelled.class::isInstance));
        assertEquals(
                1L,
                events.stream().filter(ModelProtocolEvent.UsageReported.class::isInstance).count()
        );
        var eos = assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertEquals(StopReason.STOP, eos.stopReason());
        assertEquals(
                List.of(expectedJson),
                events.stream()
                        .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                        .map(ModelProtocolEvent.OutputDelta.class::cast)
                        .map(ModelProtocolEvent.OutputDelta::payload)
                        .map(ModelPayload.StructuredJson.class::cast)
                        .map(ModelPayload.StructuredJson::json)
                        .toList()
        );
        assertTrue(events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .map(ModelProtocolEvent.OutputDelta::payload)
                .noneMatch(ModelPayload.TextChunk.class::isInstance));
    }

    private static void assertMalformedFailure(ModelProtocolEvent event) {
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                assertInstanceOf(ModelProtocolEvent.AttemptFailed.class, event).failure()
        );
    }
}
