package com.virtualcompanion.modelopenai;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * Bounded UTF-8 SSE framing decoder for Chat Completions data events.
 */
final class SseDecoder {

    private static final byte[] DATA_FIELD = "data".getBytes(StandardCharsets.US_ASCII);
    private static final int MAXIMUM_DATA_LINE_FRAMING_BYTES = "data: ".length();

    private SseDecoder() {
    }

    static void decode(
            InputStream input,
            int maximumEventBytes,
            EventConsumer consumer
    ) throws IOException, OpenAiCodecException {
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
            int maximumLineBytes = line.isComment()
                    ? maximumEventBytes
                    : maximumEventBytes + MAXIMUM_DATA_LINE_FRAMING_BYTES;
            if (lineBytes > maximumLineBytes) {
                throw new OpenAiCodecException();
            }
            line.accept(value);
        }
    }

    private enum LineMode {
        START,
        DATA_FIELD,
        BEFORE_VALUE,
        VALUE,
        COMMENT
    }

    private static final class LineParser {

        private final EventBuffer event;
        private LineMode mode = LineMode.START;
        private int fieldBytes;

        private LineParser(EventBuffer event) {
            this.event = event;
        }

        private void accept(int value) throws OpenAiCodecException {
            switch (mode) {
                case START -> start(value);
                case DATA_FIELD -> field(value);
                case BEFORE_VALUE -> {
                    mode = LineMode.VALUE;
                    if (value != ' ') {
                        event.append(value);
                    }
                }
                case VALUE -> event.append(value);
                case COMMENT -> {
                    // Comments are ignored after their physical-line budget is enforced.
                }
            }
        }

        private void start(int value) throws OpenAiCodecException {
            if (value == ':') {
                mode = LineMode.COMMENT;
                return;
            }
            if (value != DATA_FIELD[0]) {
                throw new OpenAiCodecException();
            }
            mode = LineMode.DATA_FIELD;
            fieldBytes = 1;
        }

        private void field(int value) throws OpenAiCodecException {
            if (fieldBytes < DATA_FIELD.length) {
                if (value != DATA_FIELD[fieldBytes]) {
                    throw new OpenAiCodecException();
                }
                fieldBytes++;
                return;
            }
            if (value != ':') {
                throw new OpenAiCodecException();
            }
            event.beginLine();
            mode = LineMode.BEFORE_VALUE;
        }

        private void finish() throws OpenAiCodecException {
            if (mode == LineMode.DATA_FIELD && fieldBytes == DATA_FIELD.length) {
                event.beginLine();
                return;
            }
            if (mode == LineMode.START || mode == LineMode.DATA_FIELD) {
                throw new OpenAiCodecException();
            }
        }

        private void reset() {
            mode = LineMode.START;
            fieldBytes = 0;
        }

        private boolean isComment() {
            return mode == LineMode.COMMENT;
        }
    }

    private static final class EventBuffer {

        private final int maximumBytes;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private boolean hasData;

        private EventBuffer(int maximumBytes) {
            this.maximumBytes = maximumBytes;
        }

        private void beginLine() throws OpenAiCodecException {
            if (hasData) {
                append('\n');
            }
            hasData = true;
        }

        private void append(int value) throws OpenAiCodecException {
            if (bytes.size() >= maximumBytes) {
                throw new OpenAiCodecException();
            }
            bytes.write(value);
        }

        private boolean hasData() {
            return hasData;
        }

        private boolean dispatch(EventConsumer consumer) throws OpenAiCodecException {
            String data = decodeUtf8(bytes.toByteArray());
            bytes.reset();
            hasData = false;
            return consumer.onEvent(data);
        }

        private String decodeUtf8(byte[] value) throws OpenAiCodecException {
            try {
                return StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(value))
                        .toString();
            } catch (CharacterCodingException exception) {
                throw new OpenAiCodecException();
            }
        }
    }

    @FunctionalInterface
    interface EventConsumer {
        boolean onEvent(String data) throws OpenAiCodecException;
    }
}
