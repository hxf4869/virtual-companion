package com.virtualcompanion.modelanthropic;

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
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static java.net.http.HttpResponse.BodyHandlers;

/**
 * One-request, single-consumer asynchronous session with serialized terminal
 * arbitration.
 */
public final class AnthropicMessagesSession implements ModelProtocolSession {

    private static final int MAX_PENDING_OUTPUT_EVENTS = 64;
    private static final int MAX_SUCCESS_TERMINAL_BATCH_EVENTS = 3;
    private static final int MAX_BUFFERED_EVENT_REFERENCES =
            MAX_PENDING_OUTPUT_EVENTS + MAX_SUCCESS_TERMINAL_BATCH_EVENTS;
    private static final long MAX_STREAM_RAW_RESPONSE_BYTES = 8L * 1024 * 1024;

    private final Object stateLock = new Object();
    private final Deque<ModelProtocolEvent> events =
            new ArrayDeque<>(MAX_BUFFERED_EVENT_REFERENCES);
    private final HttpClient httpClient;
    private final HttpRequest httpRequest;
    private final ModelProtocolRequest request;
    private final InvocationBinding binding;
    private final AnthropicMessagesCodec codec;
    private final EgressDnsGuard egressDnsGuard;
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

    AnthropicMessagesSession(
            HttpClient httpClient,
            HttpRequest httpRequest,
            ModelProtocolRequest request,
            AnthropicMessagesCodec codec
    ) {
        this(httpClient, httpRequest, request, codec, EgressDnsGuard.defaults());
    }

    /**
     * Explicit guard injection exists so contract tests can prove a rejecting
     * guard never opens a connection. The codec is created internally so the
     * package-private codec type never leaks across packages.
     */
    public AnthropicMessagesSession(
            HttpClient httpClient,
            HttpRequest httpRequest,
            ModelProtocolRequest request,
            EgressDnsGuard egressDnsGuard
    ) {
        this(httpClient, httpRequest, request, new AnthropicMessagesCodec(), egressDnsGuard);
    }

    private AnthropicMessagesSession(
            HttpClient httpClient,
            HttpRequest httpRequest,
            ModelProtocolRequest request,
            AnthropicMessagesCodec codec,
            EgressDnsGuard egressDnsGuard
    ) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient must not be null");
        this.httpRequest = Objects.requireNonNull(httpRequest, "httpRequest must not be null");
        this.request = Objects.requireNonNull(request, "request must not be null");
        this.binding = request.binding();
        this.codec = Objects.requireNonNull(codec, "codec must not be null");
        this.egressDnsGuard = Objects.requireNonNull(egressDnsGuard, "egressDnsGuard must not be null");
        this.startedNanos = System.nanoTime();
        this.totalDeadlineNanos = deadline(
                startedNanos,
                request.timeoutBudget().totalTimeout()
        );
        this.workerThread = Thread.ofVirtual()
                .name("anthropic-messages-worker")
                .start(this::execute);
    }

    @Override
    public Optional<ModelProtocolEvent> next() {
        ModelProtocolEvent event = null;
        boolean interrupted = false;
        synchronized (stateLock) {
            if (terminalDelivered) {
                return Optional.empty();
            }

            while (events.isEmpty()) {
                try {
                    stateLock.wait();
                } catch (InterruptedException exception) {
                    interrupted = true;
                    break;
                }
            }
            if (!interrupted) {
                event = events.removeFirst();
                if (event.terminal()) {
                    terminalDelivered = true;
                }
                stateLock.notifyAll();
            }
        }

        if (interrupted) {
            Thread.currentThread().interrupt();
            cancel();
            synchronized (stateLock) {
                event = events.pollFirst();
                if (event != null && event.terminal()) {
                    terminalDelivered = true;
                }
                stateLock.notifyAll();
            }
        }
        return Optional.ofNullable(event);
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
        return "AnthropicMessagesSession[state=<redacted>]";
    }

    private void execute() {
        try {
            egressDnsGuard.requireAllowedResolution(httpRequest.uri());
            if (isTerminalQueued()) {
                return;
            }
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
                .name("anthropic-messages-parser")
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
                    throw new AnthropicCodecException();
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

    private void parseCompletion(InputStream body) throws AnthropicCodecException {
        var message = codec.decodeMessage(new BoundedInputStream(
                body,
                SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES
        ));
        ModelPayload payload;
        if (request.responseMode() instanceof ResponseMode.StructuredJson structured) {
            // Real tool-use protocol: the structured answer arrives in the
            // tool_use block input, never in a text block.
            var toolUse = message.toolUse()
                    .orElseThrow(AnthropicCodecException::new);
            if (!structured.schemaName().equals(toolUse.name())) {
                throw new AnthropicCodecException();
            }
            payload = new ModelPayload.StructuredJson(
                    codec.requireStructuredJson(toolUse.input())
            );
        } else {
            if (message.toolUse().isPresent()) {
                // An unclaimed tool_use without a structured consumer is a
                // protocol mismatch; fail closed instead of leaking JSON text.
                throw new AnthropicCodecException();
            }
            payload = new ModelPayload.TextChunk(message.content());
        }
        requireOutputWithinLimit(payload);
        markFirstContent();
        completeSuccessfully(payload, message.usage(), message.stopReason());
    }

    private void parseStream(InputStream body)
            throws IOException, AnthropicCodecException {
        var expectedToolName = request.responseMode() instanceof ResponseMode.StructuredJson structured
                ? structured.schemaName()
                : null;
        var state = new StreamState(expectedToolName);
        SseDecoder.decode(
                body,
                SizeLimits.MAX_STREAM_EVENT_BYTES,
                MAX_STREAM_RAW_RESPONSE_BYTES,
                data -> onStreamEvent(state, data)
        );
        if (!state.done) {
            throw new AnthropicCodecException();
        }
    }

    private boolean onStreamEvent(StreamState state, String data)
            throws AnthropicCodecException {
        if (isTerminalQueued()) {
            return false;
        }
        var event = codec.decodeStreamEvent(data);
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.MessageStart start) {
            if (state.startSeen) {
                throw new AnthropicCodecException();
            }
            state.startSeen = true;
            state.inputTokens = start.inputTokens();
            return true;
        }
        if (state.done) {
            throw new AnthropicCodecException();
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.ContentBlockStart start) {
            if (state.blockOpen) {
                throw new AnthropicCodecException();
            }
            if (state.structured) {
                if (state.blockSettled
                        || !"tool_use".equals(start.blockType())
                        || !state.expectedToolName.equals(
                                start.toolUseName().orElse(null))) {
                    throw new AnthropicCodecException();
                }
            } else if (!"text".equals(start.blockType())) {
                throw new AnthropicCodecException();
            }
            state.blockOpen = true;
            state.blockIndex = start.index();
            state.blockType = start.blockType();
            return true;
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.ContentBlockStop stop) {
            if (!state.blockOpen || stop.index() != state.blockIndex) {
                throw new AnthropicCodecException();
            }
            state.blockOpen = false;
            state.blockIndex = -1;
            state.blockType = null;
            if (state.structured) {
                // The tool_use block is complete; its input JSON is settled.
                state.blockSettled = true;
            }
            return true;
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.TextDelta delta) {
            if (!state.blockOpen
                    || delta.index() != state.blockIndex
                    || !"text".equals(state.blockType)) {
                throw new AnthropicCodecException();
            }
            if (state.structured) {
                throw new AnthropicCodecException();
            }
            addOutputBytes(state, delta.text());
            if (!emitText(delta.text())) {
                return false;
            }
            state.contentSeen = true;
            markFirstContent();
            return true;
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.InputJsonDelta delta) {
            if (!state.blockOpen
                    || delta.index() != state.blockIndex
                    || !"tool_use".equals(state.blockType)) {
                throw new AnthropicCodecException();
            }
            if (!state.structured) {
                throw new AnthropicCodecException();
            }
            addOutputBytes(state, delta.partialJson());
            state.structuredContent.append(delta.partialJson());
            state.contentSeen = true;
            markFirstContent();
            return true;
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.MessageDelta messageDelta) {
            if (messageDelta.stopReason().isPresent()) {
                if (state.stopReason != null) {
                    throw new AnthropicCodecException();
                }
                state.stopReason = messageDelta.stopReason().get();
            }
            if (messageDelta.outputTokens().isPresent()) {
                state.outputTokens = messageDelta.outputTokens().get();
            }
            return true;
        }
        if (event instanceof AnthropicMessagesCodec.AnthropicStreamEvent.MessageStop) {
            if (!state.startSeen
                    || !state.contentSeen
                    || state.stopReason == null
                    || state.outputTokens < 0
                    || state.blockOpen) {
                throw new AnthropicCodecException();
            }
            var usage = new TokenUsage(
                    state.inputTokens,
                    state.outputTokens,
                    safeSum(state.inputTokens, state.outputTokens)
            );
            ModelPayload structuredPayload = null;
            if (state.structured) {
                if (!state.blockSettled) {
                    throw new AnthropicCodecException();
                }
                var structuredJson = codec.requireStructuredJson(
                        state.structuredContent.toString());
                requireOutputWithinLimit(structuredJson);
                structuredPayload = new ModelPayload.StructuredJson(
                        structuredJson
                );
            }
            completeSuccessfully(structuredPayload, usage, state.stopReason);
            state.done = true;
            return false;
        }
        return true;
    }

    private static void requireOutputWithinLimit(ModelPayload payload)
            throws AnthropicCodecException {
        String content = switch (payload) {
            case ModelPayload.TextChunk text -> text.text();
            case ModelPayload.StructuredJson structured -> structured.json();
        };
        requireOutputWithinLimit(content);
    }

    private static void requireOutputWithinLimit(String content)
            throws AnthropicCodecException {
        if (SizeLimits.utf8Bytes(content) > SizeLimits.MAX_TOTAL_OUTPUT_BYTES) {
            throw new AnthropicCodecException();
        }
    }

    private static void addOutputBytes(StreamState state, String content)
            throws AnthropicCodecException {
        long deltaBytes = SizeLimits.utf8Bytes(content);
        if (state.trailingHighSurrogate
                && !content.isEmpty()
                && Character.isLowSurrogate(content.charAt(0))) {
            // SizeLimits counts isolated surrogates as one replacement byte.
            // When adjacent deltas complete a pair, the joined output is four
            // UTF-8 bytes, so account for the two-byte boundary difference.
            deltaBytes += 2;
        }
        if (deltaBytes > SizeLimits.MAX_TOTAL_OUTPUT_BYTES - state.outputBytes) {
            throw new AnthropicCodecException();
        }
        state.outputBytes += deltaBytes;
        if (!content.isEmpty()) {
            state.trailingHighSurrogate = Character.isHighSurrogate(
                    content.charAt(content.length() - 1)
            );
        }
    }

    private void markFirstContent() {
        firstContentSeen.complete(null);
    }

    private boolean emitText(String text) {
        synchronized (stateLock) {
            while (!terminalQueued
                    && events.size() >= MAX_PENDING_OUTPUT_EVENTS) {
                try {
                    stateLock.wait();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    if (terminalQueued) {
                        return false;
                    }
                    throw new CancellationException();
                }
            }
            if (terminalQueued) {
                return false;
            }
            enqueue(new ModelProtocolEvent.OutputDelta(
                    binding,
                    nextSequence,
                    new ModelPayload.TextChunk(text)
            ));
            nextSequence++;
            stateLock.notifyAll();
            return true;
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
            requireCapacity(finalPayload == null
                    ? 2
                    : MAX_SUCCESS_TERMINAL_BATCH_EVENTS);
            terminalQueued = true;
            if (finalPayload != null) {
                enqueue(new ModelProtocolEvent.OutputDelta(
                        binding,
                        nextSequence,
                        finalPayload
                ));
                nextSequence++;
            }
            enqueue(new ModelProtocolEvent.UsageReported(
                    binding,
                    nextSequence,
                    usage
            ));
            nextSequence++;
            enqueue(new ModelProtocolEvent.AttemptEos(
                    binding,
                    nextSequence,
                    stopReason
            ));
            nextSequence++;
            stateLock.notifyAll();
        }
    }

    private boolean terminateFailed(AdapterFailure failure) {
        synchronized (stateLock) {
            if (terminalQueued) {
                return false;
            }
            requireCapacity(1);
            terminalQueued = true;
            enqueue(new ModelProtocolEvent.AttemptFailed(
                    binding,
                    nextSequence,
                    failure
            ));
            nextSequence++;
            stateLock.notifyAll();
            return true;
        }
    }

    private boolean terminateCancelled() {
        synchronized (stateLock) {
            if (terminalQueued) {
                return false;
            }
            requireCapacity(1);
            terminalQueued = true;
            enqueue(new ModelProtocolEvent.AttemptCancelled(
                    binding,
                    nextSequence
            ));
            nextSequence++;
            stateLock.notifyAll();
            return true;
        }
    }

    private boolean isTerminalQueued() {
        synchronized (stateLock) {
            return terminalQueued;
        }
    }

    private void enqueue(ModelProtocolEvent event) {
        requireCapacity(1);
        events.addLast(event);
    }

    private void requireCapacity(int additionalEvents) {
        if (additionalEvents <= 0
                || events.size() > MAX_BUFFERED_EVENT_REFERENCES - additionalEvents) {
            throw new IllegalStateException("event buffer capacity exceeded");
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
        if (cause instanceof AnthropicCodecException) {
            return new AdapterFailure.MalformedResponse();
        }
        if (cause instanceof IllegalArgumentException) {
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

    private static long safeSum(long inputTokens, long outputTokens) {
        if (inputTokens > Long.MAX_VALUE - outputTokens) {
            return Long.MAX_VALUE;
        }
        return inputTokens + outputTokens;
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
        private final String expectedToolName;
        private final StringBuilder structuredContent = new StringBuilder();
        private boolean startSeen;
        private boolean contentSeen;
        private boolean blockOpen;
        private long blockIndex = -1;
        private String blockType;
        private boolean blockSettled;
        private StopReason stopReason;
        private long inputTokens;
        private long outputTokens = -1;
        private long outputBytes;
        private boolean trailingHighSurrogate;
        private boolean done;

        private StreamState(String expectedToolName) {
            this.structured = expectedToolName != null;
            this.expectedToolName = expectedToolName;
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
