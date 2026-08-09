package com.virtualcompanion.modelopenai;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static java.net.http.HttpResponse.BodyHandlers;

/**
 * One-request, single-consumer asynchronous session with serialized terminal
 * arbitration.
 */
final class OpenAiChatCompletionsSession implements ModelProtocolSession {

    private final Object stateLock = new Object();
    private final BlockingQueue<ModelProtocolEvent> events = new LinkedBlockingQueue<>();
    private final HttpClient httpClient;
    private final HttpRequest httpRequest;
    private final ModelProtocolRequest request;
    private final InvocationBinding binding;
    private final OpenAiChatCompletionsCodec codec;
    private final long startedNanos;
    private final long totalDeadlineNanos;
    private final CompletableFuture<Void> firstContentSeen = new CompletableFuture<>();

    private volatile CompletableFuture<HttpResponse<InputStream>> responseFuture;
    private volatile InputStream responseBody;
    private volatile Thread parserThread;
    private volatile Thread workerThread;

    private long nextSequence;
    private boolean terminalQueued;
    private boolean terminalDelivered;

    OpenAiChatCompletionsSession(
            HttpClient httpClient,
            HttpRequest httpRequest,
            ModelProtocolRequest request,
            OpenAiChatCompletionsCodec codec
    ) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient must not be null");
        this.httpRequest = Objects.requireNonNull(httpRequest, "httpRequest must not be null");
        this.request = Objects.requireNonNull(request, "request must not be null");
        this.binding = request.binding();
        this.codec = Objects.requireNonNull(codec, "codec must not be null");
        this.startedNanos = System.nanoTime();
        this.totalDeadlineNanos = deadline(
                startedNanos,
                request.timeoutBudget().totalTimeout()
        );
        this.workerThread = Thread.ofVirtual()
                .name("openai-chat-completions-worker")
                .start(this::execute);
    }

    @Override
    public Optional<ModelProtocolEvent> next() {
        synchronized (stateLock) {
            if (terminalDelivered) {
                return Optional.empty();
            }
        }

        final ModelProtocolEvent event;
        try {
            event = events.take();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            cancel();
            return deliver(events.poll());
        }
        return deliver(event);
    }

    private Optional<ModelProtocolEvent> deliver(ModelProtocolEvent event) {
        if (event == null) {
            return Optional.empty();
        }
        if (event.terminal()) {
            synchronized (stateLock) {
                terminalDelivered = true;
            }
        }
        return Optional.of(event);
    }

    @Override
    public void cancel() {
        if (terminateCancelled()) {
            abortIo();
        }
    }

    @Override
    public void close() {
        cancel();
    }

    @Override
    public String toString() {
        return "OpenAiChatCompletionsSession[state=<redacted>]";
    }

    private void execute() {
        try {
            responseFuture = httpClient.sendAsync(
                    httpRequest,
                    BodyHandlers.ofInputStream()
            );
            if (isTerminalQueued()) {
                responseFuture.cancel(true);
                return;
            }
            var response = awaitResponse(responseFuture, request.timeoutBudget());
            responseBody = response.body();
            if (isTerminalQueued()) {
                return;
            }

            var statusFailure = statusFailure(response.statusCode());
            if (statusFailure != null) {
                terminateFailed(statusFailure);
                return;
            }
            if (!validContentType(response)) {
                terminateFailed(new AdapterFailure.MalformedResponse());
                return;
            }

            parseWithinBudgets(responseBody);
        } catch (Throwable throwable) {
            if (!isTerminalQueued()) {
                var failure = normalizeFailure(throwable);
                if (terminateFailed(failure)) {
                    abortIo();
                }
            }
        } finally {
            closeResponseBody();
        }
    }

    private HttpResponse<InputStream> awaitResponse(
            CompletableFuture<HttpResponse<InputStream>> future,
            TimeoutBudget budget
    ) throws Exception {
        long connectDeadline = deadline(startedNanos, budget.connectTimeout());
        long waitDeadline = Math.min(connectDeadline, totalDeadlineNanos);
        var timeoutPhase = connectDeadline <= totalDeadlineNanos
                ? AdapterFailure.TimeoutPhase.CONNECT
                : AdapterFailure.TimeoutPhase.TOTAL;
        try {
            return future.get(
                    remaining(waitDeadline, timeoutPhase),
                    TimeUnit.NANOSECONDS
            );
        } catch (TimeoutException exception) {
            throw new PhaseTimeout(timeoutPhase);
        } catch (ExecutionException exception) {
            throw new TransportFailure(exception.getCause());
        }
    }

    private void parseWithinBudgets(InputStream body) throws Exception {
        var parserDone = new CompletableFuture<Void>();
        parserThread = Thread.ofVirtual()
                .name("openai-chat-completions-parser")
                .start(() -> {
                    try {
                        if (request.streaming()) {
                            parseStream(body);
                        } else {
                            parseCompletion(body);
                        }
                        parserDone.complete(null);
                    } catch (Throwable throwable) {
                        parserDone.completeExceptionally(throwable);
                    }
                });

        long firstTokenDeadline = deadline(
                System.nanoTime(),
                request.timeoutBudget().firstTokenTimeout()
        );
        awaitFirstContent(parserDone, firstTokenDeadline);
        awaitParser(parserDone);
    }

    private void awaitFirstContent(
            CompletableFuture<Void> parserDone,
            long firstTokenDeadline
    ) throws Exception {
        while (!firstContentSeen.isDone()) {
            if (parserDone.isDone()) {
                awaitCompletedParser(parserDone);
                if (!firstContentSeen.isDone()) {
                    throw new OpenAiCodecException();
                }
                return;
            }
            long waitDeadline = Math.min(firstTokenDeadline, totalDeadlineNanos);
            var timeoutPhase = firstTokenDeadline <= totalDeadlineNanos
                    ? AdapterFailure.TimeoutPhase.FIRST_TOKEN
                    : AdapterFailure.TimeoutPhase.TOTAL;
            try {
                CompletableFuture.anyOf(firstContentSeen, parserDone)
                        .get(
                                remaining(waitDeadline, timeoutPhase),
                                TimeUnit.NANOSECONDS
                        );
            } catch (TimeoutException exception) {
                throw new PhaseTimeout(timeoutPhase);
            } catch (ExecutionException exception) {
                throw new TransportFailure(exception.getCause());
            }
        }
    }

    private void awaitParser(CompletableFuture<Void> parserDone)
            throws Exception {
        try {
            parserDone.get(
                    remaining(
                            totalDeadlineNanos,
                            AdapterFailure.TimeoutPhase.TOTAL
                    ),
                    TimeUnit.NANOSECONDS
            );
        } catch (TimeoutException exception) {
            throw new PhaseTimeout(AdapterFailure.TimeoutPhase.TOTAL);
        } catch (ExecutionException exception) {
            throw new TransportFailure(exception.getCause());
        }
    }

    private static void awaitCompletedParser(CompletableFuture<Void> parserDone)
            throws Exception {
        try {
            parserDone.get();
        } catch (ExecutionException exception) {
            throw new TransportFailure(exception.getCause());
        }
    }

    private void parseCompletion(InputStream body) throws OpenAiCodecException {
        var completion = codec.decodeCompletion(new BoundedInputStream(
                body,
                SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES
        ));
        if (SizeLimits.utf8Bytes(completion.content())
                > SizeLimits.MAX_TOTAL_OUTPUT_BYTES) {
            throw new OpenAiCodecException();
        }
        markFirstContent();
        ModelPayload payload = request.responseMode() instanceof ResponseMode.StructuredJson
                ? new ModelPayload.StructuredJson(
                        codec.requireStructuredJson(completion.content())
                )
                : new ModelPayload.TextChunk(completion.content());
        completeSuccessfully(payload, completion.usage(), completion.stopReason());
    }

    private void parseStream(InputStream body)
            throws IOException, OpenAiCodecException {
        var state = new StreamState(
                request.responseMode() instanceof ResponseMode.StructuredJson
        );
        SseDecoder.decode(
                body,
                SizeLimits.MAX_STREAM_EVENT_BYTES,
                data -> onSseData(state, data)
        );
        if (!state.done) {
            throw new OpenAiCodecException();
        }
    }

    private boolean onSseData(StreamState state, String data)
            throws OpenAiCodecException {
        if (SizeLimits.utf8Bytes(data) > SizeLimits.MAX_STREAM_EVENT_BYTES) {
            throw new OpenAiCodecException();
        }
        if ("[DONE]".equals(data)) {
            if (state.done
                    || !state.contentSeen
                    || state.stopReason == null
                    || state.usage == null) {
                throw new OpenAiCodecException();
            }
            ModelPayload structuredPayload = null;
            if (state.structured) {
                structuredPayload = new ModelPayload.StructuredJson(
                        codec.requireStructuredJson(state.structuredContent.toString())
                );
            }
            completeSuccessfully(structuredPayload, state.usage, state.stopReason);
            state.done = true;
            return false;
        }
        if (state.done || state.usage != null) {
            throw new OpenAiCodecException();
        }

        var chunk = codec.decodeStreamChunk(data);
        if (chunk instanceof OpenAiChatCompletionsCodec.UsageChunk usageChunk) {
            if (state.stopReason == null) {
                throw new OpenAiCodecException();
            }
            state.usage = usageChunk.usage();
            return true;
        }

        var choice = (OpenAiChatCompletionsCodec.ChoiceChunk) chunk;
        if (state.stopReason != null) {
            throw new OpenAiCodecException();
        }
        if (choice.content().isPresent()) {
            var content = choice.content().orElseThrow();
            long contentBytes = SizeLimits.utf8Bytes(content);
            if (contentBytes > SizeLimits.MAX_TOTAL_OUTPUT_BYTES - state.outputBytes) {
                throw new OpenAiCodecException();
            }
            state.outputBytes += contentBytes;
            state.contentSeen = true;
            markFirstContent();
            if (state.structured) {
                state.structuredContent.append(content);
            } else {
                emitText(content);
            }
        }
        choice.finishReason().ifPresent(reason -> state.stopReason = reason);
        return true;
    }

    private void markFirstContent() {
        firstContentSeen.complete(null);
    }

    private void emitText(String text) {
        synchronized (stateLock) {
            if (terminalQueued) {
                return;
            }
            events.add(new ModelProtocolEvent.OutputDelta(
                    binding,
                    nextSequence++,
                    new ModelPayload.TextChunk(text)
            ));
        }
    }

    private void completeSuccessfully(
            ModelPayload finalPayload,
            TokenUsage usage,
            StopReason stopReason
    ) {
        synchronized (stateLock) {
            if (terminalQueued) {
                return;
            }
            if (finalPayload != null) {
                events.add(new ModelProtocolEvent.OutputDelta(
                        binding,
                        nextSequence++,
                        finalPayload
                ));
            }
            events.add(new ModelProtocolEvent.UsageReported(
                    binding,
                    nextSequence++,
                    usage
            ));
            terminalQueued = true;
            events.add(new ModelProtocolEvent.AttemptEos(
                    binding,
                    nextSequence++,
                    stopReason
            ));
        }
    }

    private boolean terminateFailed(AdapterFailure failure) {
        synchronized (stateLock) {
            if (terminalQueued) {
                return false;
            }
            terminalQueued = true;
            events.add(new ModelProtocolEvent.AttemptFailed(
                    binding,
                    nextSequence++,
                    failure
            ));
            return true;
        }
    }

    private boolean terminateCancelled() {
        synchronized (stateLock) {
            if (terminalQueued) {
                return false;
            }
            terminalQueued = true;
            events.add(new ModelProtocolEvent.AttemptCancelled(
                    binding,
                    nextSequence++
            ));
            return true;
        }
    }

    private boolean isTerminalQueued() {
        synchronized (stateLock) {
            return terminalQueued;
        }
    }

    private void abortIo() {
        var future = responseFuture;
        if (future != null) {
            future.cancel(true);
        }
        closeResponseBody();
        interrupt(parserThread);
        interrupt(workerThread);
    }

    private void closeResponseBody() {
        var body = responseBody;
        responseBody = null;
        if (body != null) {
            try {
                body.close();
            } catch (IOException ignored) {
                // Terminal state is already normalized; no provider detail leaks.
            }
        }
    }

    private static void interrupt(Thread thread) {
        if (thread != null && thread != Thread.currentThread()) {
            thread.interrupt();
        }
    }

    private static AdapterFailure statusFailure(int statusCode) {
        if (statusCode == 200) {
            return null;
        }
        if (statusCode == 429) {
            return new AdapterFailure.RateLimited();
        }
        if (statusCode >= 500 && statusCode <= 599) {
            return new AdapterFailure.UpstreamUnavailable();
        }
        return new AdapterFailure.MalformedResponse();
    }

    private boolean validContentType(HttpResponse<?> response) {
        var contentType = response.headers()
                .firstValue("Content-Type")
                .orElse("");
        var mediaType = contentType.split(";", 2)[0].trim();
        return request.streaming()
                ? "text/event-stream".equalsIgnoreCase(mediaType)
                : "application/json".equalsIgnoreCase(mediaType);
    }

    private static AdapterFailure normalizeFailure(Throwable throwable) {
        var cause = unwrap(throwable);
        if (cause instanceof PhaseTimeout timeout) {
            return new AdapterFailure.Timeout(timeout.phase);
        }
        if (cause instanceof HttpConnectTimeoutException) {
            return new AdapterFailure.Timeout(AdapterFailure.TimeoutPhase.CONNECT);
        }
        if (cause instanceof HttpTimeoutException) {
            return new AdapterFailure.Timeout(AdapterFailure.TimeoutPhase.TOTAL);
        }
        if (cause instanceof OpenAiCodecException) {
            return new AdapterFailure.MalformedResponse();
        }
        if (cause instanceof CancellationException) {
            return new AdapterFailure.Disconnected();
        }
        if (cause instanceof IOException) {
            return new AdapterFailure.Disconnected();
        }
        return new AdapterFailure.Disconnected();
    }

    private static Throwable unwrap(Throwable throwable) {
        var current = throwable;
        while ((current instanceof TransportFailure
                || current instanceof ExecutionException)
                && current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }

    private static long deadline(long startNanos, Duration duration) {
        long addition;
        try {
            addition = duration.toNanos();
        } catch (ArithmeticException exception) {
            return Long.MAX_VALUE;
        }
        if (addition > Long.MAX_VALUE - startNanos) {
            return Long.MAX_VALUE;
        }
        return startNanos + addition;
    }

    private static long remaining(
            long deadlineNanos,
            AdapterFailure.TimeoutPhase timeoutPhase
    ) throws PhaseTimeout {
        long value = deadlineNanos - System.nanoTime();
        if (value <= 0) {
            throw new PhaseTimeout(timeoutPhase);
        }
        return value;
    }

    private static final class StreamState {
        private final boolean structured;
        private final StringBuilder structuredContent = new StringBuilder();
        private long outputBytes;
        private boolean contentSeen;
        private StopReason stopReason;
        private TokenUsage usage;
        private boolean done;

        private StreamState(boolean structured) {
            this.structured = structured;
        }
    }

    private static final class PhaseTimeout extends Exception {
        private final AdapterFailure.TimeoutPhase phase;

        private PhaseTimeout(AdapterFailure.TimeoutPhase phase) {
            this.phase = phase;
        }
    }

    private static final class TransportFailure extends Exception {
        private TransportFailure(Throwable cause) {
            super(cause);
        }
    }
}
