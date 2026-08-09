package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelanthropic.AnthropicMessagesAdapter;
import com.virtualcompanion.modelanthropic.AnthropicMessagesConfig;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import org.junit.jupiter.api.Test;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.ANTHROPIC_VERSION;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.API_KEY;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MAX_TOKENS;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MODEL;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.REQUESTED_AUTH;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.adapter;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.binding;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStartToolUse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.completion;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.deterministicBinding;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.drain;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.inputJsonDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.invalidStructuredRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.toolUseCompletion;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnthropicMessagesBoundaryContractTest {

    @Test
    void deterministic_binding_and_invalid_schema_make_zero_network_calls() {
        var client = new NeverCompletingHttpClient();
        var endpoint = URI.create("http://127.0.0.1:9/v1/messages");
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
                () -> new AnthropicMessagesConfig(
                        URI.create("ftp://127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        var validConfig = new AnthropicMessagesConfig(
                URI.create("http://127.0.0.1/v1/messages"),
                API_KEY,
                ANTHROPIC_VERSION,
                MODEL,
                MAX_TOKENS
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesAdapter(
                        HttpClient.newBuilder()
                                .followRedirects(HttpClient.Redirect.ALWAYS)
                                .build(),
                        validConfig
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/%76%31/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://user@127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages?key=value"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages"),
                        API_KEY + "\r\nInjected: value",
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        0
                )
        );
    }

    @Test
    void config_rejects_endpoints_outside_the_egress_allowlist() {
        var anthropic = URI.create("https://api.anthropic.com/v1/messages");
        var validConfig = new AnthropicMessagesConfig(
                anthropic, API_KEY, ANTHROPIC_VERSION, MODEL, MAX_TOKENS);
        assertEquals(anthropic, validConfig.endpoint());

        assertRejected("http://api.anthropic.com/v1/messages");
        assertRejected("https://evil.example.com/v1/messages");
        assertRejected("https://api.anthropic.com:8443/v1/messages");
        assertRejected("https://192.168.1.5/v1/messages");
        assertRejected("https://10.0.0.1/v1/messages");
        assertRejected("https://172.16.0.1/v1/messages");
        assertRejected("https://169.254.169.254/v1/messages");
        assertRejected("https://100.100.100.200/v1/messages");
        assertRejected("https://127.0.0.2/v1/messages");
        assertRejected("https://8.8.8.8/v1/messages");
        assertRejected("https://[::1]/v1/messages");
    }

    private void assertRejected(String endpoint) {
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create(endpoint), API_KEY, ANTHROPIC_VERSION, MODEL, MAX_TOKENS));
    }

    @Test
    void config_rejects_unicode_header_key_without_leak_or_network() {
        var invalidKey = "synthetic-key-密钥-🙂";
        var client = new NeverCompletingHttpClient();

        var failure = assertThrows(
                IllegalArgumentException.class,
                () -> {
                    var config = new AnthropicMessagesConfig(
                            URI.create("http://127.0.0.1:9/v1/messages"),
                            invalidKey,
                            ANTHROPIC_VERSION,
                            MODEL,
                            MAX_TOKENS
                    );
                    new AnthropicMessagesAdapter(client, config)
                            .open(textRequest(false, "must stay offline"));
                }
        );

        assertFalse(failure.toString().contains(invalidKey));
        assertFalse(failure.toString().contains("密钥"));
        assertEquals(0, client.calls());
    }

    @Test
    void new_type_string_representations_are_secret_and_body_free() {
        var endpoint = URI.create("http://127.0.0.1:9/v1/messages");
        var config = new AnthropicMessagesConfig(endpoint, API_KEY, ANTHROPIC_VERSION, MODEL, MAX_TOKENS);
        var client = new NeverCompletingHttpClient();
        var adapter = new AnthropicMessagesAdapter(client, config);
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
                assertFalse(value.contains(API_KEY));
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
        var chunk = textDelta("multi-data");
        int split = chunk.indexOf(",\"index\"");
        var multiline = "data: " + chunk.substring(0, split + 1) + "\n"
                + "data: " + chunk.substring(split + 1) + "\n\n";
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream",
                sse(messageStart(1))
                        + sse(contentBlockStart())
                        + multiline
                        + sse(contentBlockStop())
                        + sse(messageDelta("end_turn", 1))
                        + sse(messageStop())
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
                                    events.get(0)
                            ).payload()).text()
            );
        }
    }

    @Test
    void non_bmp_sse_data_at_exact_limit_succeeds_and_closes_body() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = textDelta("🙂");
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        String data = " ".repeat(limit - chunkBytes) + chunk;
        assertEquals(limit, data.getBytes(StandardCharsets.UTF_8).length);
        byte[] response = concat(
                sse(messageStart(1)).getBytes(StandardCharsets.UTF_8),
                sse(contentBlockStart()).getBytes(StandardCharsets.UTF_8),
                ("data: " + data + "\n\n").getBytes(StandardCharsets.UTF_8),
                successfulTextTail().getBytes(StandardCharsets.UTF_8)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertSuccessfulText(events, "🙂");
        body.awaitClosed();
    }

    @Test
    void non_bmp_sse_data_one_over_stops_before_dispatch_and_success() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = textDelta("🙂");
        int chunkBytes = chunk.getBytes(StandardCharsets.UTF_8).length;
        String data = " ".repeat(limit - chunkBytes) + chunk + " ";
        assertEquals(limit + 1, data.getBytes(StandardCharsets.UTF_8).length);
        byte[] response = ("data: " + data + "\n\nSENTINEL")
                .getBytes(StandardCharsets.UTF_8);
        long offendingByte = "data: ".length() + (long) limit + 1;
        var body = new TrackingInputStream(response, offendingByte);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertNoSuccessfulEvents(events);
        assertEquals(offendingByte, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void multiline_sse_data_at_exact_limit_counts_inserted_lf() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = textDelta("multi-limit");
        int paddingBytes = limit - chunk.getBytes(StandardCharsets.UTF_8).length - 1;
        int firstLineBytes = paddingBytes / 2;
        String multiline = "data: " + " ".repeat(firstLineBytes) + "\n"
                + "data: " + " ".repeat(paddingBytes - firstLineBytes) + chunk + "\n\n";
        byte[] response = (sse(messageStart(1))
                + sse(contentBlockStart())
                + multiline
                + successfulTextTail()).getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertSuccessfulText(events, "multi-limit");
        body.awaitClosed();
    }

    @Test
    void multiline_sse_data_one_over_stops_at_combined_payload_fence() throws Exception {
        int limit = SizeLimits.MAX_STREAM_EVENT_BYTES;
        String chunk = textDelta("multi-limit");
        int paddingBytes = limit - chunk.getBytes(StandardCharsets.UTF_8).length;
        int firstLineBytes = paddingBytes / 2;
        byte[] prefix = (sse(messageStart(1)) + sse(contentBlockStart()))
                .getBytes(StandardCharsets.UTF_8);
        String multiline = "data: " + " ".repeat(firstLineBytes) + "\n"
                + "data: " + " ".repeat(paddingBytes - firstLineBytes) + chunk
                + "\n\nSENTINEL";
        byte[] response = concat(prefix, multiline.getBytes(StandardCharsets.UTF_8));
        long offendingByte = prefix.length + (long) limit
                + 2L * "data: ".length() + 1L;
        var body = new TrackingInputStream(response, offendingByte);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals(offendingByte, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void non_streaming_raw_body_exact_limit_with_non_bmp_succeeds_and_closes()
            throws Exception {
        byte[] response = paddedCompletionBodyWithNonBmp(
                SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longTextRequest(false)));

        assertSuccessfulText(events, "🙂");
        assertEquals(response.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void non_streaming_raw_body_one_over_reads_only_probe_and_fails_malformed()
            throws Exception {
        int limit = SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES;
        byte[] response = paddedCompletionBodyWithNonBmp(limit + 4096);
        var body = new TrackingInputStream(response, limit + 1L, limit);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longTextRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertNoSuccessfulEvents(events);
        assertEquals(limit + 1L, body.bytesRead());
        assertFalse(body.bulkReadRequestedPastFence());
        body.awaitClosed();
    }

    @Test
    void invalid_utf8_sse_data_fails_before_dispatching_that_event() throws Exception {
        byte[] valid = (sse(messageStart(1))
                + sse(contentBlockStart())
                + sse(textDelta("before-invalid"))).getBytes(StandardCharsets.UTF_8);
        String invalidChunk = textDelta("replace-me");
        int marker = invalidChunk.indexOf("replace-me");
        byte[] invalid = concat(
                ("data: " + invalidChunk.substring(0, marker))
                        .getBytes(StandardCharsets.UTF_8),
                new byte[]{(byte) 0xc3, (byte) 0x28},
                (invalidChunk.substring(marker + "replace-me".length()) + "\n\nSENTINEL")
                        .getBytes(StandardCharsets.UTF_8)
        );
        var body = new TrackingInputStream(concat(valid, invalid), Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertEquals(List.of("before-invalid"), textDeltas(events));
        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < valid.length + invalid.length);
        body.awaitClosed();
    }

    @Test
    void streaming_text_output_exact_limit_succeeds() throws Exception {
        int firstBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES / 2;
        int secondAsciiBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES - firstBytes - 4;
        byte[] response = textStream(
                "a".repeat(firstBytes),
                "b".repeat(secondAsciiBytes) + "🙂"
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertSuccessfulText(
                events,
                "a".repeat(firstBytes) + "b".repeat(secondAsciiBytes) + "🙂"
        );
        body.awaitClosed();
    }

    @Test
    void streaming_text_output_one_over_rejects_offending_delta() throws Exception {
        int firstBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES / 2;
        int secondBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES - firstBytes + 1;
        byte[] response = textStream(
                "a".repeat(firstBytes),
                "b".repeat(secondBytes)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertEquals(List.of("a".repeat(firstBytes)), textDeltas(events));
        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < response.length);
        body.awaitClosed();
    }

    @Test
    void streaming_output_counts_surrogate_pair_split_across_deltas_exactly()
            throws Exception {
        int firstBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES / 2;
        int secondAsciiBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES - firstBytes - 4;
        byte[] response = textStreamWithJsonEncodedDeltas(
                "a".repeat(firstBytes),
                "b".repeat(secondAsciiBytes) + "\\uD83D",
                "\\uDE42"
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        String expected = "a".repeat(firstBytes)
                + "b".repeat(secondAsciiBytes)
                + "🙂";
        assertEquals(SizeLimits.MAX_TOTAL_OUTPUT_BYTES, SizeLimits.utf8Bytes(expected));
        assertSuccessfulText(events, expected);
        body.awaitClosed();
    }

    @Test
    void streaming_output_rejects_one_over_surrogate_pair_split_across_deltas()
            throws Exception {
        int firstBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES / 2;
        int secondAsciiBytes = SizeLimits.MAX_TOTAL_OUTPUT_BYTES - firstBytes - 4;
        byte[] response = textStreamWithJsonEncodedDeltas(
                "a".repeat(firstBytes),
                "b".repeat(secondAsciiBytes) + "\\uD83D",
                "\\uDE42x"
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true)));

        assertEquals(2L, events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .count());
        assertMalformedFailure(events.getLast());
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.bytesRead() < response.length);
        body.awaitClosed();
    }

    @Test
    void streaming_structured_output_exact_limit_succeeds() throws Exception {
        String json = structuredJson(SizeLimits.MAX_TOTAL_OUTPUT_BYTES);
        int split = json.length() / 2;
        byte[] response = structuredStream(
                json.substring(0, split),
                json.substring(split)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longStructuredRequest(true)));

        assertEquals(
                new ModelPayload.StructuredJson(json),
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.getFirst()).payload()
        );
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        body.awaitClosed();
    }

    @Test
    void streaming_structured_output_one_over_fails_before_append_or_success()
            throws Exception {
        String json = structuredJson(SizeLimits.MAX_TOTAL_OUTPUT_BYTES + 1);
        int split = json.length() / 2;
        byte[] response = structuredStream(
                json.substring(0, split),
                json.substring(split)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longStructuredRequest(true)));

        assertMalformedFailure(events.getFirst());
        assertNoSuccessfulEvents(events);
        assertTrue(body.bytesRead() < response.length);
        body.awaitClosed();
    }

    @Test
    void non_streaming_output_one_over_fails_without_output_usage_or_eos()
            throws Exception {
        byte[] response = completion(
                "x".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES + 1),
                "end_turn",
                1,
                1
        ).getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longTextRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertNoSuccessfulEvents(events);
        assertEquals(response.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void non_streaming_text_output_at_exact_limit_succeeds() throws Exception {
        String output = "x".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES - 4) + "🙂";
        byte[] response = completion(output, "end_turn", 1, 1)
                .getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longTextRequest(false)));

        assertSuccessfulText(events, output);
        body.awaitClosed();
    }

    @Test
    void non_streaming_structured_output_at_exact_limit_succeeds() throws Exception {
        String output = structuredJson(SizeLimits.MAX_TOTAL_OUTPUT_BYTES);
        byte[] response = toolUseCompletion(output, "end_turn", 1, 1)
                .getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longStructuredRequest(false)));

        assertEquals(
                new ModelPayload.StructuredJson(output),
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.getFirst()).payload()
        );
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        body.awaitClosed();
    }

    @Test
    void non_streaming_structured_output_one_over_fails_before_success() throws Exception {
        String output = structuredJson(SizeLimits.MAX_TOTAL_OUTPUT_BYTES + 1);
        byte[] response = toolUseCompletion(output, "end_turn", 1, 1)
                .getBytes(StandardCharsets.UTF_8);
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(adapter(
                new StaticInputHttpClient("application/json", body),
                offlineEndpoint()
        ).open(longStructuredRequest(false)));

        assertMalformedFailure(events.getFirst());
        assertNoSuccessfulEvents(events);
        body.awaitClosed();
    }

    @Test
    void explicit_cancellation_after_delta_closes_streaming_body() throws Exception {
        var body = new BlockingAfterDataInputStream(
                (sse(messageStart(1))
                        + sse(contentBlockStart())
                        + sse(textDelta("before-cancel")))
                        .getBytes(StandardCharsets.UTF_8)
        );
        var session = adapter(
                new StaticInputHttpClient("text/event-stream", body),
                offlineEndpoint()
        ).open(longTextRequest(true));

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
    void streaming_rejects_json_content_type_without_parsing_body()
            throws Exception {
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}"
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
        assertTrue(List.of(AnthropicMessagesAdapter.class.getConstructors()).stream()
                .allMatch(constructor -> List.of(constructor.getParameterTypes())
                        .contains(AnthropicMessagesConfig.class)));

        var root = findRepositoryRoot();
        final String adapterSources;
        try (Stream<Path> sourcePaths = Files.walk(
                root.resolve("service/adapters/model-anthropic/src/main/java")
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
        assertFalse(adapterSources.contains("api.anthropic.com"));
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
        assertTrue(runtimePom.contains("virtual-companion-model-anthropic"));

        var runtimeConfig = Files.readString(
                root.resolve("service/apps/runtime/src/main/resources/application.yaml")
        );
        // The master switch defaults to disabled, and no provider endpoint,
        // secret literal or committed URL exists in runtime configuration.
        assertTrue(runtimeConfig.contains("${VC_MODEL_PROVIDERS_ENABLED:false}"));
        assertFalse(runtimeConfig.contains("api.anthropic.com"));
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
        return URI.create("http://127.0.0.1:9/v1/messages");
    }

    private static ModelProtocolRequest longTextRequest(boolean streaming) {
        return textRequest(
                binding(),
                streaming,
                "bounded response",
                longTimeoutBudget()
        );
    }

    private static ModelProtocolRequest longStructuredRequest(boolean streaming) {
        return AnthropicContractTestSupport.request(
                binding(),
                streaming,
                new ResponseMode.StructuredJson(
                        "companion_response",
                        "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},"
                                + "\"required\":[\"answer\"],\"additionalProperties\":false}"
                ),
                "bounded response",
                longTimeoutBudget()
        );
    }

    private static TimeoutBudget longTimeoutBudget() {
        return new TimeoutBudget(
                Duration.ofSeconds(5),
                Duration.ofSeconds(15),
                Duration.ofSeconds(40)
        );
    }

    private static String successfulTextTail() {
        return sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1))
                + sse(messageStop());
    }

    private static byte[] textStream(String... deltas) {
        var response = new StringBuilder()
                .append(sse(messageStart(1)))
                .append(sse(contentBlockStart()));
        for (String delta : deltas) {
            response.append(sse(textDelta(delta)));
        }
        return response.append(successfulTextTail())
                .toString()
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] textStreamWithJsonEncodedDeltas(String... encodedDeltas) {
        var response = new StringBuilder()
                .append(sse(messageStart(1)))
                .append(sse(contentBlockStart()));
        for (String encodedDelta : encodedDeltas) {
            response.append(sse("{\"type\":\"content_block_delta\",\"index\":0,"
                    + "\"delta\":{\"type\":\"text_delta\",\"text\":\""
                    + encodedDelta
                    + "\"}}"));
        }
        return response.append(successfulTextTail())
                .toString()
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] structuredStream(String... deltas) {
        var response = new StringBuilder()
                .append(sse(messageStart(1)))
                .append(sse(contentBlockStartToolUse()));
        for (String delta : deltas) {
            response.append(sse(inputJsonDelta(delta)));
        }
        return response
                .append(sse(contentBlockStop()))
                .append(sse(messageDelta("end_turn", 1)))
                .append(sse(messageStop()))
                .toString()
                .getBytes(StandardCharsets.UTF_8);
    }

    private static String structuredJson(int targetBytes) {
        String prefix = "{\"answer\":\"";
        String suffix = "\"}";
        int fixedBytes = prefix.getBytes(StandardCharsets.UTF_8).length
                + suffix.getBytes(StandardCharsets.UTF_8).length;
        if (targetBytes < fixedBytes) {
            throw new IllegalArgumentException("targetBytes is too small");
        }
        String result = prefix + "x".repeat(targetBytes - fixedBytes) + suffix;
        assertEquals(targetBytes, result.getBytes(StandardCharsets.UTF_8).length);
        return result;
    }

    private static byte[] paddedCompletionBodyWithNonBmp(int targetBytes) {
        String value = completion("🙂", "end_turn", 1, 1);
        String prefix = value.substring(0, value.length() - 1) + ",\"padding\":\"";
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

    private static List<String> textDeltas(List<ModelProtocolEvent> events) {
        var result = new ArrayList<String>();
        for (ModelProtocolEvent event : events) {
            if (event instanceof ModelProtocolEvent.OutputDelta delta
                    && delta.payload() instanceof ModelPayload.TextChunk text) {
                result.add(text.text());
            }
        }
        return List.copyOf(result);
    }

    private static void assertSuccessfulText(
            List<ModelProtocolEvent> events,
            String expectedText
    ) {
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptFailed.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptCancelled.class::isInstance));
        assertEquals(expectedText, String.join("", textDeltas(events)));
        assertEquals(
                1L,
                events.stream().filter(ModelProtocolEvent.UsageReported.class::isInstance).count()
        );
        assertEquals(
                StopReason.STOP,
                assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast())
                        .stopReason()
        );
    }

    private static void assertMalformedFailure(ModelProtocolEvent event) {
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                assertInstanceOf(ModelProtocolEvent.AttemptFailed.class, event).failure()
        );
    }

    private static void assertNoSuccessfulEvents(List<ModelProtocolEvent> events) {
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream().noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
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
        private boolean closedFlag;

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
                while (!closedFlag) {
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
            closedFlag = true;
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
}
