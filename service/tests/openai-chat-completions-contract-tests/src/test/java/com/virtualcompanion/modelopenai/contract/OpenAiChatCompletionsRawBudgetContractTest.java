package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
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
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.binding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.drain;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsRawBudgetContractTest {

    private static final int MAX_STREAM_RAW_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final URI OFFLINE_ENDPOINT =
            URI.create("http://127.0.0.1:9/v1/chat/completions");

    @Test
    void exact_production_budget_completes_and_closes_body() throws Exception {
        byte[] successfulStream = successfulTextStream("at-exact-budget");
        byte[] response = new byte[MAX_STREAM_RAW_RESPONSE_BYTES];
        int paddingBytes = response.length - successfulStream.length;
        Arrays.fill(response, 0, paddingBytes, (byte) '\n');
        System.arraycopy(
                successfulStream,
                0,
                response,
                paddingBytes,
                successfulStream.length
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = assertTimeoutPreemptively(
                Duration.ofSeconds(30),
                () -> drain(open(body, longRequest()))
        );

        assertEquals(List.of("at-exact-budget"), textDeltas(events));
        assertEquals(1, events.stream()
                .filter(ModelProtocolEvent.UsageReported.class::isInstance)
                .count());
        assertEquals(
                StopReason.STOP,
                assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast())
                        .stopReason()
        );
        assertEquals(MAX_STREAM_RAW_RESPONSE_BYTES, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void control_flood_after_delta_hits_one_over_without_reset_or_sentinel()
            throws Exception {
        byte[] prefix = sse(choiceChunk("before-over", null))
                .getBytes(StandardCharsets.UTF_8);
        byte[] controls = (": keepalive\r\n\r\n\n\n")
                .getBytes(StandardCharsets.UTF_8);
        byte[] sentinel = "SENTINEL".getBytes(StandardCharsets.US_ASCII);
        byte[] response = new byte[MAX_STREAM_RAW_RESPONSE_BYTES + 1 + sentinel.length];
        int position = 0;
        System.arraycopy(prefix, 0, response, position, prefix.length);
        position += prefix.length;
        for (int repetition = 0; repetition < 64; repetition++) {
            System.arraycopy(controls, 0, response, position, controls.length);
            position += controls.length;
        }
        Arrays.fill(response, position, MAX_STREAM_RAW_RESPONSE_BYTES, (byte) '\n');
        response[MAX_STREAM_RAW_RESPONSE_BYTES] = 'X';
        System.arraycopy(
                sentinel,
                0,
                response,
                MAX_STREAM_RAW_RESPONSE_BYTES + 1,
                sentinel.length
        );
        var body = new TrackingInputStream(
                response,
                MAX_STREAM_RAW_RESPONSE_BYTES + 1L
        );

        var events = assertTimeoutPreemptively(
                Duration.ofSeconds(30),
                () -> drain(open(body, longRequest()))
        );

        assertEquals(List.of("before-over"), textDeltas(events));
        assertMalformed(events);
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals(MAX_STREAM_RAW_RESPONSE_BYTES + 1L, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void empty_data_keeps_existing_malformed_and_early_stop_semantics()
            throws Exception {
        byte[] accepted = "data:\n\n".getBytes(StandardCharsets.US_ASCII);
        byte[] response = concat(
                accepted,
                "SENTINEL".getBytes(StandardCharsets.US_ASCII)
        );
        var body = new TrackingInputStream(response, Long.MAX_VALUE);

        var events = drain(open(body, longRequest()));

        assertMalformed(events);
        assertEquals(1, events.size());
        assertEquals(accepted.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void done_stops_before_late_sentinel_and_does_not_consume_ended_budget()
            throws Exception {
        byte[] accepted = successfulTextStream("before-done");
        byte[] response = concat(
                accepted,
                "SENTINEL".getBytes(StandardCharsets.US_ASCII)
        );
        var body = new TrackingInputStream(response, accepted.length);

        var events = drain(open(body, longRequest()));

        assertEquals(List.of("before-done"), textDeltas(events));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertEquals(accepted.length, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void structured_partial_is_not_exposed_when_raw_budget_overflows()
            throws Exception {
        byte[] prefix = sse(choiceChunk("{\"answer\":\"partial", null))
                .getBytes(StandardCharsets.UTF_8);
        byte[] sentinel = "SENTINEL".getBytes(StandardCharsets.US_ASCII);
        byte[] response = new byte[MAX_STREAM_RAW_RESPONSE_BYTES + 1 + sentinel.length];
        System.arraycopy(prefix, 0, response, 0, prefix.length);
        Arrays.fill(response, prefix.length, MAX_STREAM_RAW_RESPONSE_BYTES, (byte) '\n');
        response[MAX_STREAM_RAW_RESPONSE_BYTES] = 'X';
        System.arraycopy(
                sentinel,
                0,
                response,
                MAX_STREAM_RAW_RESPONSE_BYTES + 1,
                sentinel.length
        );
        var body = new TrackingInputStream(
                response,
                MAX_STREAM_RAW_RESPONSE_BYTES + 1L
        );

        var events = assertTimeoutPreemptively(
                Duration.ofSeconds(30),
                () -> drain(open(body, structuredLongRequest()))
        );

        assertMalformed(events);
        assertEquals(1, events.size());
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertEquals(MAX_STREAM_RAW_RESPONSE_BYTES + 1L, body.bytesRead());
        body.awaitClosed();
    }

    @Test
    void first_token_and_total_timeouts_close_blocked_raw_streams() throws Exception {
        var beforeContent = new BlockingAfterDataInputStream(
                ": keepalive\n\n\n".getBytes(StandardCharsets.UTF_8)
        );
        var firstTokenEvents = assertTimeoutPreemptively(
                Duration.ofSeconds(5),
                () -> drain(open(beforeContent, request(new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofMillis(150),
                        Duration.ofSeconds(2)
                ))))
        );
        assertEquals(
                AdapterFailure.TimeoutPhase.FIRST_TOKEN,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        onlyFailure(firstTokenEvents)
                ).phase()
        );
        beforeContent.awaitClosed();

        byte[] totalPrefix = sse(choiceChunk("before-total-timeout", null))
                .getBytes(StandardCharsets.UTF_8);
        byte[] lateContentlessFrame = sse(choiceChunk(null, null))
                .getBytes(StandardCharsets.UTF_8);
        var afterContent = new CloseReleasedLateInputStream(
                totalPrefix,
                lateContentlessFrame
        );
        var totalEvents = assertTimeoutPreemptively(
                Duration.ofSeconds(5),
                () -> drain(open(afterContent, request(new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofMillis(300)
                ))))
        );
        assertEquals(List.of("before-total-timeout"), textDeltas(totalEvents));
        assertEquals(
                AdapterFailure.TimeoutPhase.TOTAL,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        onlyFailure(totalEvents)
                ).phase()
        );
        assertTrue(totalEvents.stream()
                .noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(totalEvents.stream()
                .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        afterContent.awaitClosed();
        afterContent.awaitReaderStopped();
        assertEquals(
                totalPrefix.length + lateContentlessFrame.length,
                afterContent.bytesRead()
        );
    }

    @Test
    void repeated_cancel_and_close_stop_blocked_body_without_late_events()
            throws Exception {
        byte[] prefix = sse(choiceChunk("before-cancel", null))
                .getBytes(StandardCharsets.UTF_8);
        byte[] lateContentlessFrame = sse(choiceChunk(null, null))
                .getBytes(StandardCharsets.UTF_8);
        var body = new CloseReleasedLateInputStream(prefix, lateContentlessFrame);
        var session = open(body, longRequest());

        var first = assertTimeoutPreemptively(
                Duration.ofSeconds(5),
                () -> session.next().orElseThrow()
        );
        assertEquals(
                "before-cancel",
                assertInstanceOf(
                        ModelPayload.TextChunk.class,
                        assertInstanceOf(ModelProtocolEvent.OutputDelta.class, first).payload()
                ).text()
        );
        body.awaitWaitingForClose();

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
        body.awaitClosed();
        body.awaitReaderStopped();
        assertEquals(prefix.length + lateContentlessFrame.length, body.bytesRead());
    }

    private static ModelProtocolSession open(
            InputStream body,
            ModelProtocolRequest request
    ) {
        return adapter(
                new StaticInputHttpClient("text/event-stream", body),
                OFFLINE_ENDPOINT
        ).open(request);
    }

    private static ModelProtocolRequest longRequest() {
        return request(new TimeoutBudget(
                Duration.ofSeconds(5),
                Duration.ofSeconds(30),
                Duration.ofSeconds(60)
        ));
    }

    private static ModelProtocolRequest request(TimeoutBudget budget) {
        return textRequest(binding(), true, "raw budget", budget);
    }

    private static ModelProtocolRequest structuredLongRequest() {
        return OpenAiContractTestSupport.request(
                binding(),
                true,
                new ResponseMode.StructuredJson(
                        "companion_response",
                        "{\"type\":\"object\",\"properties\":{"
                                + "\"answer\":{\"type\":\"string\"}},"
                                + "\"required\":[\"answer\"],"
                                + "\"additionalProperties\":false}"
                ),
                "raw budget",
                new TimeoutBudget(
                        Duration.ofSeconds(5),
                        Duration.ofSeconds(30),
                        Duration.ofSeconds(60)
                )
        );
    }

    private static byte[] successfulTextStream(String text) {
        return (sse(choiceChunk(text, null))
                + sse(choiceChunk(null, "stop"))
                + sse(usageChunk(1, 1))
                + done())
                .getBytes(StandardCharsets.UTF_8);
    }

    private static void assertMalformed(List<ModelProtocolEvent> events) {
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                onlyFailure(events)
        );
    }

    private static AdapterFailure onlyFailure(List<ModelProtocolEvent> events) {
        return assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getLast()
        ).failure();
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
        private final CountDownLatch closed = new CountDownLatch(1);
        private volatile int position;

        private TrackingInputStream(byte[] data, long failAfterBytes) {
            this.data = Objects.requireNonNull(data, "data must not be null");
            this.failAfterBytes = failAfterBytes;
        }

        @Override
        public int read() {
            if (position >= data.length) {
                return -1;
            }
            if (position >= failAfterBytes) {
                throw new AssertionError("response parser read beyond the allowed fence");
            }
            return data[position++] & 0xff;
        }

        @Override
        public void close() {
            closed.countDown();
        }

        private long bytesRead() {
            return position;
        }

        private void awaitClosed() throws InterruptedException {
            assertTrue(closed.await(2, TimeUnit.SECONDS), "response body was not closed");
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

    private static final class CloseReleasedLateInputStream extends InputStream {

        private static final byte[] SENTINEL =
                "SENTINEL".getBytes(StandardCharsets.US_ASCII);

        private final byte[] data;
        private final int releaseOffset;
        private final CountDownLatch waitingForClose = new CountDownLatch(1);
        private final CountDownLatch closed = new CountDownLatch(1);
        private volatile int position;
        private volatile Thread readerThread;
        private boolean released;

        private CloseReleasedLateInputStream(byte[] prefix, byte[] lateFrame) {
            this.data = concat(
                    Objects.requireNonNull(prefix, "prefix must not be null"),
                    Objects.requireNonNull(lateFrame, "lateFrame must not be null"),
                    SENTINEL
            );
            this.releaseOffset = prefix.length;
        }

        @Override
        public synchronized int read() {
            readerThread = Thread.currentThread();
            while (position >= releaseOffset && !released) {
                waitingForClose.countDown();
                try {
                    wait();
                } catch (InterruptedException ignored) {
                    // A hostile or buffered body may ignore interruption and remain readable.
                }
            }
            if (position >= data.length) {
                return -1;
            }
            return data[position++] & 0xff;
        }

        @Override
        public synchronized void close() {
            released = true;
            closed.countDown();
            notifyAll();
        }

        private int bytesRead() {
            return position;
        }

        private void awaitWaitingForClose() throws InterruptedException {
            assertTrue(
                    waitingForClose.await(2, TimeUnit.SECONDS),
                    "response parser did not wait for body close"
            );
        }

        private void awaitClosed() throws InterruptedException {
            assertTrue(closed.await(2, TimeUnit.SECONDS), "response body was not closed");
        }

        private void awaitReaderStopped() throws InterruptedException {
            Thread reader = readerThread;
            assertTrue(reader != null, "response parser never read the body");
            reader.join(2_000);
            assertTrue(!reader.isAlive(), "response parser kept reading after terminal");
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
}
