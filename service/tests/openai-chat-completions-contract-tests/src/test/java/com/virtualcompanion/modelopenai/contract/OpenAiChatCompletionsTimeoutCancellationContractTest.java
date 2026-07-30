package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

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

class OpenAiChatCompletionsTimeoutCancellationContractTest {

    @Test
    void connect_timeout() {
        var client = new NeverCompletingHttpClient();
        var budgets = new TimeoutBudget(
                Duration.ofMillis(150),
                Duration.ofSeconds(1),
                Duration.ofSeconds(2)
        );
        var session = adapter(
                client,
                URI.create("http://127.0.0.1:9/v1/chat/completions")
        ).open(textRequest(binding(), true, "connect timeout", budgets));

        var events = assertTimeoutPreemptively(
                Duration.ofSeconds(5),
                () -> drain(session)
        );

        assertEquals(
                AdapterFailure.TimeoutPhase.CONNECT,
                assertInstanceOf(
                        AdapterFailure.Timeout.class,
                        onlyFailure(events)
                ).phase()
        );
        assertEquals(1, client.calls());
    }

    @Test
    void first_token_timeout() throws Exception {
        var release = new CountDownLatch(1);
        try (var server = new MockOpenAiServer(exchange -> {
            MockOpenAiServer.beginChunked(exchange, "text/event-stream");
            MockOpenAiServer.writeAndFlush(exchange, ": keepalive\n\n");
            awaitRelease(release);
        })) {
            var client = new CountingHttpClient();
            var budgets = new TimeoutBudget(
                    Duration.ofSeconds(1),
                    Duration.ofMillis(150),
                    Duration.ofSeconds(2)
            );
            try {
                var events = assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () -> drain(adapter(client, server.endpoint()).open(
                                textRequest(binding(), true, "first token", budgets)
                        ))
                );

                assertEquals(
                        AdapterFailure.TimeoutPhase.FIRST_TOKEN,
                        assertInstanceOf(
                                AdapterFailure.Timeout.class,
                                onlyFailure(events)
                        ).phase()
                );
                assertEquals(1, server.requestCount());
                assertEquals(1, client.asynchronousCalls());
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void total_timeout() throws Exception {
        var release = new CountDownLatch(1);
        var lateWriteAttempted = new CountDownLatch(1);
        try (var server = new MockOpenAiServer(exchange -> {
            MockOpenAiServer.beginChunked(exchange, "text/event-stream");
            MockOpenAiServer.writeAndFlush(
                    exchange,
                    sse(choiceChunk("partial-before-total-timeout", null))
            );
            awaitRelease(release);
            try {
                MockOpenAiServer.writeAndFlush(
                        exchange,
                        sse(choiceChunk(null, "stop"))
                                + sse(usageChunk(1, 1))
                                + done()
                );
            } finally {
                lateWriteAttempted.countDown();
            }
        })) {
            var client = new CountingHttpClient();
            var budgets = new TimeoutBudget(
                    Duration.ofSeconds(1),
                    Duration.ofSeconds(1),
                    Duration.ofMillis(300)
            );
            try {
                var events = assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () -> drain(adapter(client, server.endpoint()).open(
                                textRequest(binding(), true, "total", budgets)
                        ))
                );

                assertEquals(
                        "partial-before-total-timeout",
                        assertInstanceOf(
                                ModelPayload.TextChunk.class,
                                assertInstanceOf(
                                        ModelProtocolEvent.OutputDelta.class,
                                        events.getFirst()
                                ).payload()
                        ).text()
                );
                assertEquals(
                        AdapterFailure.TimeoutPhase.TOTAL,
                        assertInstanceOf(
                                AdapterFailure.Timeout.class,
                                onlyFailure(events)
                        ).phase()
                );
                assertTrue(events.stream()
                        .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
                assertEquals(1, client.asynchronousCalls());
            } finally {
                release.countDown();
                assertTrue(lateWriteAttempted.await(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test
    void cancellation() throws Exception {
        var release = new CountDownLatch(1);
        try (var server = new MockOpenAiServer(exchange -> {
            MockOpenAiServer.beginChunked(exchange, "text/event-stream");
            MockOpenAiServer.writeAndFlush(
                    exchange,
                    sse(choiceChunk("before-cancel", null))
            );
            awaitRelease(release);
        })) {
            var client = new CountingHttpClient();
            var session = adapter(client, server.endpoint()).open(
                    textRequest(true, "cancel")
            );
            try {
                var first = assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () -> session.next().orElseThrow()
                );
                assertEquals(
                        "before-cancel",
                        assertInstanceOf(
                                ModelPayload.TextChunk.class,
                                assertInstanceOf(
                                        ModelProtocolEvent.OutputDelta.class,
                                        first
                                ).payload()
                        ).text()
                );

                session.cancel();
                session.cancel();
                session.close();
                session.close();
                var cancelled = assertInstanceOf(
                        ModelProtocolEvent.AttemptCancelled.class,
                        session.next().orElseThrow()
                );
                assertEquals(binding(), cancelled.binding());
                assertEquals(1, cancelled.sequence());
                assertTrue(session.next().isEmpty());
                assertEquals(1, server.requestCount());
                assertEquals(1, client.asynchronousCalls());
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void late_token_fence() throws Exception {
        var releaseLate = new CountDownLatch(1);
        var lateAttempted = new CountDownLatch(1);
        var lateWriteSucceeded = new AtomicBoolean();
        try (var server = new MockOpenAiServer(exchange -> {
            MockOpenAiServer.beginChunked(exchange, "text/event-stream");
            MockOpenAiServer.writeAndFlush(
                    exchange,
                    sse(choiceChunk("on-time", null))
                            + sse(choiceChunk(null, "stop"))
                            + sse(usageChunk(1, 1))
                            + done()
            );
            awaitRelease(releaseLate);
            try {
                MockOpenAiServer.writeAndFlush(
                        exchange,
                        sse(choiceChunk("late-must-be-discarded", null))
                );
                lateWriteSucceeded.set(true);
            } catch (Exception ignored) {
                // A closed response is also an acceptable late-byte fence.
            } finally {
                lateAttempted.countDown();
            }
        })) {
            var session = adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(true, "late"));
            var events = assertTimeoutPreemptively(
                    Duration.ofSeconds(5),
                    () -> drain(session)
            );
            assertEquals(List.of("on-time"), events.stream()
                    .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                    .map(ModelProtocolEvent.OutputDelta.class::cast)
                    .map(ModelProtocolEvent.OutputDelta::payload)
                    .map(ModelPayload.TextChunk.class::cast)
                    .map(ModelPayload.TextChunk::text)
                    .toList());

            releaseLate.countDown();
            assertTrue(lateAttempted.await(5, TimeUnit.SECONDS));
            assertTrue(session.next().isEmpty());
            assertTrue(
                    !lateWriteSucceeded.get() || session.next().isEmpty(),
                    "even an accepted late socket write must not become an event"
            );
        }
    }

    private static AdapterFailure onlyFailure(List<ModelProtocolEvent> events) {
        return assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getLast()
        ).failure();
    }

    private static void awaitRelease(CountDownLatch release) {
        try {
            release.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }
}
