package com.virtualcompanion.modelanthropic;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * Bounded UTF-8 SSE framing decoder for Anthropic Messages data events.
 *
 * <p>Anthropic streams explicit {@code event:} lines paired with {@code data:}
 * lines. The JSON payload repeats the type in its {@code type} field, so the
 * {@code event} line is redundant and intentionally ignored. Heartbeat lines
 * such as {@code ": ping"} are comments and ignored.</p>
 */
final class SseDecoder {

    private static final byte[] DATA_FIELD = "data".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] EVENT_FIELD = "event".getBytes(StandardCharsets.US_ASCII);
    private static final int DATA_LINE_FRAMING_BYTES = "data: ".length();
    private static final int EVENT_LINE_FRAMING_BYTES = "event: ".length();

    private SseDecoder() {
    }

    static void decode(
            InputStream input,
            int maximumEventBytes,
            EventConsumer consumer
    ) throws IOException, AnthropicCodecException {
        Objects.requireNonNull(input, "input must not be null");
        Objects.requireNonNull(consumer, "consumer must not be null");
        if (maximumEventBytes <= 0) {
            throw new IllegalArgumentException("maximumEventBytes must be positive");
        }

        var event = new EventBuffer(maximumEventBytes);
        var line = new LineParser(event);
        int lineBytes = 0;
        boolean skipLineFeed = false;

        while (true) {
            int value = input.read();
            if (value < 0) {
                if (lineBytes > 0) {
                    line.finish();
                }
                if (event.hasData()) {
                    event.dispatch(consumer);
                }
                return;
            }

            if (skipLineFeed) {
                skipLineFeed = false;
                if (value == '\n') {
                    continue;
                }
            }

            if (value == '\r' || value == '\n') {
                if (lineBytes == 0) {
                    if (event.hasData() && !event.dispatch(consumer)) {
                        return;
                    }
                } else {
                    line.finish();
                }
                line.reset();
                lineBytes = 0;
                skipLineFeed = value == '\r';
                continue;
            }

            lineBytes++;
            int maximumLineBytes = line.maximumLineBytes(maximumEventBytes);
            if (lineBytes > maximumLineBytes) {
                throw new AnthropicCodecException();
            }
            line.accept(value);
        }
    }

    private enum LineMode {
        START,
        DATA_FIELD,
        EVENT_FIELD,
        BEFORE_DATA_VALUE,
        DATA_VALUE,
        BEFORE_EVENT_VALUE,
        EVENT_VALUE,
        COMMENT
    }

    private static final class LineParser {

        private final EventBuffer event;
        private LineMode mode = LineMode.START;
        private int fieldBytes;

        private LineParser(EventBuffer event) {
            this.event = event;
        }

        private void accept(int value) throws AnthropicCodecException {
            switch (mode) {
                case START -> start(value);
                case DATA_FIELD -> field(value, DATA_FIELD, true);
                case EVENT_FIELD -> field(value, EVENT_FIELD, false);
                case BEFORE_DATA_VALUE -> {
                    mode = LineMode.DATA_VALUE;
                    if (value != ' ') {
                        event.append(value);
                    }
                }
                case DATA_VALUE -> event.append(value);
                case BEFORE_EVENT_VALUE -> {
                    mode = LineMode.EVENT_VALUE;
                }
                case EVENT_VALUE, COMMENT -> {
                    // Event names and comments are framing only.
                }
            }
        }

        private void start(int value) throws AnthropicCodecException {
            if (value == ':') {
                mode = LineMode.COMMENT;
                return;
            }
            if (value == DATA_FIELD[0]) {
                mode = LineMode.DATA_FIELD;
                fieldBytes = 1;
                return;
            }
            if (value == EVENT_FIELD[0]) {
                mode = LineMode.EVENT_FIELD;
                fieldBytes = 1;
                return;
            }
            throw new AnthropicCodecException();
        }

        private void field(
                int value,
                byte[] expected,
                boolean data
        ) throws AnthropicCodecException {
            if (fieldBytes < expected.length) {
                if (value != expected[fieldBytes]) {
                    throw new AnthropicCodecException();
                }
                fieldBytes++;
                return;
            }
            if (value != ':') {
                throw new AnthropicCodecException();
            }
            if (data) {
                event.beginLine();
                mode = LineMode.BEFORE_DATA_VALUE;
            } else {
                mode = LineMode.BEFORE_EVENT_VALUE;
            }
        }

        private void finish() throws AnthropicCodecException {
            if (mode == LineMode.DATA_FIELD && fieldBytes == DATA_FIELD.length) {
                event.beginLine();
                return;
            }
            if (mode == LineMode.EVENT_FIELD && fieldBytes == EVENT_FIELD.length) {
                return;
            }
            if (mode == LineMode.START
                    || mode == LineMode.DATA_FIELD
                    || mode == LineMode.EVENT_FIELD) {
                throw new AnthropicCodecException();
            }
        }

        private int maximumLineBytes(int maximumEventBytes) {
            return switch (mode) {
                case COMMENT -> maximumEventBytes;
                case DATA_FIELD, BEFORE_DATA_VALUE, DATA_VALUE ->
                        maximumEventBytes + DATA_LINE_FRAMING_BYTES;
                case EVENT_FIELD, BEFORE_EVENT_VALUE, EVENT_VALUE ->
                        maximumEventBytes + EVENT_LINE_FRAMING_BYTES;
                case START -> maximumEventBytes;
            };
        }

        private void reset() {
            mode = LineMode.START;
            fieldBytes = 0;
        }
    }

    private static final class EventBuffer {

        private final int maximumBytes;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private boolean hasData;

        private EventBuffer(int maximumBytes) {
            this.maximumBytes = maximumBytes;
        }

        private void beginLine() throws AnthropicCodecException {
            if (hasData) {
                append('\n');
            }
            hasData = true;
        }

        private void append(int value) throws AnthropicCodecException {
            if (bytes.size() >= maximumBytes) {
                throw new AnthropicCodecException();
            }
            bytes.write(value);
        }

        private boolean hasData() {
            return hasData;
        }

        private boolean dispatch(EventConsumer consumer) throws AnthropicCodecException {
            String data = decodeUtf8(bytes.toByteArray());
            bytes.reset();
            hasData = false;
            return consumer.onEvent(data);
        }

        private String decodeUtf8(byte[] value) throws AnthropicCodecException {
            try {
                return StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(value))
                        .toString();
            } catch (CharacterCodingException exception) {
                throw new AnthropicCodecException();
            }
        }
    }

    @FunctionalInterface
    interface EventConsumer {
        boolean onEvent(String data) throws AnthropicCodecException;
    }
}
