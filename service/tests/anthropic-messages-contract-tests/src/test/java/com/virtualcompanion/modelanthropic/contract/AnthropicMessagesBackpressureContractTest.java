package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
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
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.adapter;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.completion;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStartToolUse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.drain;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.inputJsonDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.structuredRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnthropicMessagesBackpressureContractTest {

    private static final URI ENDPOINT = URI.create("https://api.anthropic.com/v1/messages");
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
        assertEquals(70, outputCount(events));
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void slowConsumerBackpressuresAtSixtyFourAndResumesWithoutLoss() throws Exception {
        var body = new TrackingInputStream(streamBody(70));
        var session = openStreamingText(body, Duration.ofSeconds(5));

        awaitBackpressured(session);
        assertEquals(PENDING_OUTPUT_LIMIT, queuedEventCount(session));
        assertFalse(body.closed());

        var events = drain(session);

        assertEquals(72, events.size());
        assertEquals(70, outputCount(events));
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(70));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.get(71));
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

        assertEquals(PENDING_OUTPUT_LIMIT, outputCount(events));
        assertInstanceOf(ModelProtocolEvent.AttemptCancelled.class, events.getLast());
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void totalTimeoutTerminatesAFullQueueWithoutLateEvents() throws Exception {
        var body = new TrackingInputStream(streamBody(100));
        var session = openStreamingText(body, Duration.ofSeconds(1));

        awaitBackpressured(session);
        assertTrue(body.awaitClosed(Duration.ofSeconds(3)));
        var events = drain(session);

        assertEquals(PENDING_OUTPUT_LIMIT, outputCount(events));
        var failed = assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getLast()
        );
        var timeout = assertInstanceOf(AdapterFailure.Timeout.class, failed.failure());
        assertEquals(AdapterFailure.TimeoutPhase.TOTAL, timeout.phase());
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertFalse(events.stream().anyMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
    }

    @Test
    void structuredCancellationStopsAtTheDispatchBoundaryWithoutReadingSentinel()
            throws Exception {
        String acceptedPrefix = sse(messageStart(3))
                + sse(contentBlockStartToolUse())
                + sse(inputJsonDelta("{\"answer\":"));
        String cancelledFrame = sse(inputJsonDelta("\"late\"}"));
        String sentinel = sse(contentBlockStop())
                + sse(messageDelta("end_turn", 2))
                + sse(messageStop());
        byte[] bytes = (acceptedPrefix + cancelledFrame + sentinel)
                .getBytes(StandardCharsets.UTF_8);
        int cancelAfterBytes = (acceptedPrefix + cancelledFrame)
                .getBytes(StandardCharsets.UTF_8).length;
        var body = new BoundaryCancellingInputStream(bytes, cancelAfterBytes);
        var session = adapter(
                new StaticBodyHttpClient(body, "text/event-stream"),
                ENDPOINT
        ).open(structuredRequest(true, "structured-cancel"));
        body.cancelAtBoundary(session::cancel);

        var events = drain(session);

        assertEquals(1, events.size());
        assertInstanceOf(ModelProtocolEvent.AttemptCancelled.class, events.getFirst());
        assertEquals(cancelAfterBytes, body.bytesRead());
        assertTrue(body.bytesRead() < bytes.length);
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void structuredStreamingSuccessUsesTheReservedThreeEventBatch() throws Exception {
        String answer = "{\"answer\":\"bounded\"}";
        var body = new TrackingInputStream((
                sse(messageStart(3))
                        + sse(contentBlockStartToolUse())
                        + sse(inputJsonDelta(answer))
                        + sse(contentBlockStop())
                        + sse(messageDelta("end_turn", 2))
                        + sse(messageStop())
        ).getBytes(StandardCharsets.UTF_8));
        var session = adapter(
                new StaticBodyHttpClient(body, "text/event-stream"),
                ENDPOINT
        ).open(structuredRequest(true, "structured"));

        var events = drain(session);

        assertEquals(3, events.size());
        assertInstanceOf(ModelPayload.StructuredJson.class,
                assertInstanceOf(ModelProtocolEvent.OutputDelta.class, events.getFirst()).payload());
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.getLast());
        assertTrue(body.awaitClosed(Duration.ofSeconds(2)));
    }

    @Test
    void nonStreamingSuccessUsesTheReservedThreeEventBatch() throws Exception {
        var body = new TrackingInputStream(completion(
                "bounded",
                "end_turn",
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
        ).open(AnthropicContractTestSupport.textRequest(
                AnthropicContractTestSupport.binding(),
                true,
                "stream",
                budgets
        ));
    }

    private static byte[] streamBody(int contentEvents) {
        var value = new StringBuilder();
        value.append(sse(messageStart(3)));
        value.append(sse(contentBlockStart()));
        for (int index = 0; index < contentEvents; index++) {
            value.append(sse(textDelta("x")));
        }
        value.append(sse(contentBlockStop()));
        value.append(sse(messageDelta("end_turn", 2)));
        value.append(sse(messageStop()));
        return value.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static long outputCount(List<ModelProtocolEvent> events) {
        return events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .count();
    }

    private static void awaitBackpressured(ModelProtocolSession session) throws Exception {
        await(Duration.ofSeconds(2), () -> {
            Thread parser = parserThread(session);
            return queuedEventCount(session) == PENDING_OUTPUT_LIMIT
                    && parser != null
                    && parser.getState() == Thread.State.WAITING
                    && Arrays.stream(parser.getStackTrace())
                    .anyMatch(frame -> frame.getMethodName().equals("emitText"));
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

    private static Object stateLock(ModelProtocolSession session) throws Exception {
        var field = session.getClass().getDeclaredField("stateLock");
        field.setAccessible(true);
        return field.get(session);
    }

    private static int queuedEventCount(ModelProtocolSession session) throws Exception {
        Object lock = stateLock(session);
        synchronized (lock) {
            return eventQueue(session).size();
        }
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

    private static class TrackingInputStream extends ByteArrayInputStream {
        private final CountDownLatch closed = new CountDownLatch(1);

        private TrackingInputStream(byte[] bytes) {
            super(bytes);
        }

        @Override
        public void close() throws IOException {
            super.close();
            closed.countDown();
        }

        final boolean awaitClosed(Duration timeout) throws InterruptedException {
            return closed.await(timeout.toNanos(), TimeUnit.NANOSECONDS);
        }

        private boolean closed() {
            return closed.getCount() == 0;
        }
    }

    private static final class BoundaryCancellingInputStream extends TrackingInputStream {
        private final CountDownLatch callbackReady = new CountDownLatch(1);
        private final int cancelAfterBytes;
        private Runnable cancellation;
        private boolean triggered;

        private BoundaryCancellingInputStream(byte[] bytes, int cancelAfterBytes) {
            super(bytes);
            this.cancelAfterBytes = cancelAfterBytes;
        }

        private void cancelAtBoundary(Runnable cancellation) {
            this.cancellation = cancellation;
            callbackReady.countDown();
        }

        @Override
        public synchronized int read() {
            awaitCallback();
            int value = super.read();
            if (!triggered && pos == cancelAfterBytes) {
                triggered = true;
                cancellation.run();
            }
            return value;
        }

        private void awaitCallback() {
            try {
                callbackReady.await();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(exception);
            }
        }

        private synchronized int bytesRead() {
            return pos;
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
