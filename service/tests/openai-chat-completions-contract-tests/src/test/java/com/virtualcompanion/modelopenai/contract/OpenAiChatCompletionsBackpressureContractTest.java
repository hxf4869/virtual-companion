package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import org.junit.jupiter.api.Test;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
import java.io.ByteArrayInputStream;
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
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.binding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.completion;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.request;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsBackpressureContractTest {

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/chat/completions");
    private static final int PENDING_OUTPUT_LIMIT = 64;

    @Test
    void waitingConsumerIsNotStrandedWhenProducerEnqueues() throws Exception {
        var body = new TrackingInputStream(streamBody(70));
        var session = openStreamingText(body, Duration.ofSeconds(5));
        var result = CompletableFuture.supplyAsync(
                () -> drain(session),
                command -> Thread.ofVirtual().start(command)
        );

        var events = result.get(2, TimeUnit.SECONDS);

        assertEquals(72, events.size());
        assertOrderedTerminalSession(events);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void slowConsumerBackpressuresAtSixtyFourAndResumesWithoutLoss() throws Exception {
        var body = new TrackingInputStream(streamBody(70));
        var session = openStreamingText(body, Duration.ofSeconds(5));

        awaitBackpressured(session);
        assertEquals(PENDING_OUTPUT_LIMIT, eventQueue(session).size());
        assertFalse(body.closed());

        var events = drain(session);

        assertEquals(72, events.size());
        assertEquals(70, events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .count());
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(70));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.get(71));
        assertOrderedTerminalSession(events);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void cancelAndCloseReturnWhileProducerIsBackpressured() throws Exception {
        var body = new TrackingInputStream(streamBody(100));
        var session = openStreamingText(body, Duration.ofSeconds(5));

        awaitBackpressured(session);
        assertTimeoutPreemptively(Duration.ofSeconds(1), session::cancel);
        assertTimeoutPreemptively(Duration.ofSeconds(1), session::close);
        assertTimeoutPreemptively(Duration.ofSeconds(1), session::cancel);

        var events = drain(session);

        assertEquals(PENDING_OUTPUT_LIMIT, events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .count());
        assertInstanceOf(ModelProtocolEvent.AttemptCancelled.class, events.getLast());
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertOrderedTerminalSession(events);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void totalTimeoutTerminatesAFullQueueWithoutLateEvents() throws Exception {
        var body = new TrackingInputStream(streamBody(100));
        var session = openStreamingText(body, Duration.ofSeconds(1));

        awaitBackpressured(session);
        assertTrue(body.awaitClosed(Duration.ofSeconds(3)));
        var events = drain(session);

        assertEquals(PENDING_OUTPUT_LIMIT, events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .count());
        var failed = assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getLast()
        );
        var timeout = assertInstanceOf(AdapterFailure.Timeout.class, failed.failure());
        assertEquals(AdapterFailure.TimeoutPhase.TOTAL, timeout.phase());
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertOrderedTerminalSession(events);
    }

    @Test
    void structuredStreamingSuccessUsesTheReservedThreeEventBatch() throws Exception {
        String answer = "{\"answer\":\"bounded\"}";
        var body = new TrackingInputStream((
                sse(choiceChunk(answer, null))
                        + sse(choiceChunk(null, "stop"))
                        + sse(usageChunk(3, 2))
                        + done()
        ).getBytes(StandardCharsets.UTF_8));
        var mode = new ResponseMode.StructuredJson(
                "companion_response",
                "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},"
                        + "\"required\":[\"answer\"],\"additionalProperties\":false}"
        );
        var session = adapter(
                new StaticBodyHttpClient(body, "text/event-stream"),
                ENDPOINT
        ).open(request(
                binding(),
                true,
                mode,
                "structured",
                normalBudgets()
        ));

        var events = drain(session);

        assertEquals(3, events.size());
        assertInstanceOf(ModelPayload.StructuredJson.class,
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.getFirst()).payload());
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertOrderedTerminalSession(events);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void nonStreamingSuccessUsesTheReservedThreeEventBatch() throws Exception {
        var body = new TrackingInputStream(completion(
                "bounded",
                "stop",
                3,
                2
        ).getBytes(StandardCharsets.UTF_8));
        var session = adapter(
                new StaticBodyHttpClient(body, "application/json"),
                ENDPOINT
        ).open(textRequest(false, "non-stream"));

        var events = drain(session);

        assertEquals(3, events.size());
        assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.getFirst());
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertOrderedTerminalSession(events);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    private static ModelProtocolSession openStreamingText(
            TrackingInputStream body,
            Duration totalTimeout
    ) {
        var budgets = new TimeoutBudget(
                Duration.ofSeconds(2),
                Duration.ofSeconds(2),
                totalTimeout
        );
        return adapter(
                new StaticBodyHttpClient(body, "text/event-stream"),
                ENDPOINT
        ).open(textRequest(binding(), true, "stream", budgets));
    }

    private static byte[] streamBody(int contentEvents) {
        var value = new StringBuilder();
        for (int index = 0; index < contentEvents; index++) {
            value.append(sse(choiceChunk("x", null)));
        }
        value.append(sse(choiceChunk(null, "stop")));
        value.append(sse(usageChunk(3, 2)));
        value.append(done());
        return value.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void awaitBackpressured(ModelProtocolSession session) throws Exception {
        await(Duration.ofSeconds(2), () -> {
            Thread parser = parserThread(session);
            return eventQueue(session).size() == PENDING_OUTPUT_LIMIT
                    && parser != null
                    && parser.getState() == Thread.State.WAITING;
        });
        assertEquals(67, maximumBufferedEventReferences(session));
    }

    @SuppressWarnings("unchecked")
    private static Deque<ModelProtocolEvent> eventQueue(
            ModelProtocolSession session
    ) throws Exception {
        var field = session.getClass().getDeclaredField("events");
        field.setAccessible(true);
        return (Deque<ModelProtocolEvent>) field.get(session);
    }

    private static int maximumBufferedEventReferences(
            ModelProtocolSession session
    ) throws Exception {
        var field = session.getClass().getDeclaredField(
                "MAX_BUFFERED_EVENT_REFERENCES"
        );
        field.setAccessible(true);
        return field.getInt(null);
    }

    private static Thread parserThread(ModelProtocolSession session) throws Exception {
        var field = session.getClass().getDeclaredField("parserThread");
        field.setAccessible(true);
        return (Thread) field.get(session);
    }

    private static List<ModelProtocolEvent> drain(ModelProtocolSession session) {
        var events = new ArrayList<ModelProtocolEvent>();
        for (int index = 0; index < 1_000; index++) {
            var event = session.next();
            if (event.isEmpty()) {
                return List.copyOf(events);
            }
            events.add(event.orElseThrow());
        }
        throw new AssertionError("session did not terminate");
    }

    private static void assertOrderedTerminalSession(List<ModelProtocolEvent> events) {
        assertFalse(events.isEmpty());
        assertEquals(1, events.stream().filter(ModelProtocolEvent::terminal).count());
        assertTrue(events.getLast().terminal());
        for (int index = 0; index < events.size(); index++) {
            assertEquals(index, events.get(index).sequence());
            assertEquals(binding(), events.get(index).binding());
        }
    }

    private static void await(Duration timeout, CheckedBooleanSupplier condition)
            throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() >= deadline) {
                throw new AssertionError("condition was not reached before timeout");
            }
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
        }
    }

    @FunctionalInterface
    private interface CheckedBooleanSupplier {
        boolean getAsBoolean() throws Exception;
    }

    private static TimeoutBudget normalBudgets() {
        return new TimeoutBudget(
                Duration.ofSeconds(2),
                Duration.ofSeconds(2),
                Duration.ofSeconds(5)
        );
    }

    private static final class TrackingInputStream extends ByteArrayInputStream {
        private final CountDownLatch closed = new CountDownLatch(1);

        private TrackingInputStream(byte[] bytes) {
            super(bytes);
        }

        @Override
        public void close() throws IOException {
            super.close();
            closed.countDown();
        }

        private boolean awaitClosed(Duration timeout) throws InterruptedException {
            return closed.await(timeout.toNanos(), TimeUnit.NANOSECONDS);
        }

        private boolean closed() {
            return closed.getCount() == 0;
        }
    }

    private static final class StaticBodyHttpClient extends HttpClient {
        private final InputStream body;
        private final String contentType;

        private StaticBodyHttpClient(InputStream body, String contentType) {
            this.body = body;
            this.contentType = contentType;
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
        ) {
            throw new AssertionError("adapter must use sendAsync");
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(
                HttpRequest request,
                HttpResponse.BodyHandler<T> responseBodyHandler
        ) {
            return CompletableFuture.completedFuture(response(request));
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(
                HttpRequest request,
                HttpResponse.BodyHandler<T> responseBodyHandler,
                HttpResponse.PushPromiseHandler<T> pushPromiseHandler
        ) {
            return CompletableFuture.completedFuture(response(request));
        }

        @SuppressWarnings("unchecked")
        private <T> HttpResponse<T> response(HttpRequest request) {
            return new HttpResponse<>() {
                @Override
                public int statusCode() {
                    return 200;
                }

                @Override
                public HttpRequest request() {
                    return request;
                }

                @Override
                public Optional<HttpResponse<T>> previousResponse() {
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
                public T body() {
                    return (T) body;
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
                public Version version() {
                    return Version.HTTP_1_1;
                }
            };
        }
    }
}
