package com.virtualcompanion.modelopenai;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SseDecoderTest {

    @Test
    void singleDataPayloadAtLimitIsDelivered() throws Exception {
        assertEquals(List.of("abcde"), decode(event("abcde", "\n"), 5));
    }

    @Test
    void singleDataPayloadOneOverFailsBeforeDispatch() {
        var events = new ArrayList<String>();

        assertThrows(
                OpenAiCodecException.class,
                () -> decode(event("abcdef", "\n"), 5, events)
        );
        assertTrue(events.isEmpty());
    }

    @Test
    void multilinePayloadCountsInsertedLfAtLimit() throws Exception {
        var exact = "data: abc\ndata: de\n\n".getBytes(StandardCharsets.US_ASCII);
        var oneOver = "data: abc\ndata: def\n\n".getBytes(StandardCharsets.US_ASCII);

        assertEquals(List.of("abc\nde"), decode(exact, 6));
        var events = new ArrayList<String>();
        assertThrows(
                OpenAiCodecException.class,
                () -> decode(oneOver, 6, events)
        );
        assertTrue(events.isEmpty());
    }

    @Test
    void nonBmpUtf8UsesEncodedByteLimit() throws Exception {
        String exactPayload = "🙂";
        String oneOverPayload = "🙂a";

        assertEquals(List.of(exactPayload), decode(event(exactPayload, "\n"), 4));
        var events = new ArrayList<String>();
        assertThrows(
                OpenAiCodecException.class,
                () -> decode(event(oneOverPayload, "\n"), 4, events)
        );
        assertTrue(events.isEmpty());
    }

    @Test
    void commentsAreIgnoredButRemainIndividuallyBounded() throws Exception {
        var exact = ":xx\n\ndata: ok\n\n".getBytes(StandardCharsets.US_ASCII);
        var oneOver = ":xxx\n\ndata: ok\n\n".getBytes(StandardCharsets.US_ASCII);

        assertEquals(List.of("ok"), decode(exact, 3));
        var events = new ArrayList<String>();
        assertThrows(
                OpenAiCodecException.class,
                () -> decode(oneOver, 3, events)
        );
        assertTrue(events.isEmpty());
    }

    @Test
    void crlfAndCrFramingBothDispatchEvents() throws Exception {
        var payload = "data: one\r\n\r\ndata: two\r\r".getBytes(StandardCharsets.US_ASCII);

        assertEquals(List.of("one", "two"), decode(payload, 3));
    }

    @Test
    void eofFinishesFinalDataLineAndEmptyDataIsDelivered() throws Exception {
        assertEquals(List.of("eof"), decode("data: eof".getBytes(StandardCharsets.US_ASCII), 3));
        assertEquals(List.of(""), decode("data:\n\n".getBytes(StandardCharsets.US_ASCII), 1));
    }

    @Test
    void malformedUtf8FailsClosedWithoutReplacementOrDispatch() {
        byte[] malformed = concat(
                bytes("data: "),
                new byte[]{(byte) 0xc3, (byte) 0x28},
                bytes("\n\n")
        );
        var events = new ArrayList<String>();

        OpenAiCodecException failure = assertThrows(
                OpenAiCodecException.class,
                () -> decode(malformed, 8, events)
        );

        assertTrue(events.isEmpty());
        assertEquals("OpenAI Chat Completions payload failed validation", failure.getMessage());
        assertNull(failure.getCause());
    }

    @Test
    void oneOverStopsAtOffendingByteWithoutReadingFollowingSentinel() {
        int maximum = 3;
        byte[] payload = concat(
                bytes("data: "),
                bytes("abcd"),
                bytes("\n\nSENTINEL")
        );
        var input = new PositionInputStream(payload);
        var events = new ArrayList<String>();

        assertThrows(
                OpenAiCodecException.class,
                () -> SseDecoder.decode(input, maximum, Long.MAX_VALUE, data -> {
                    events.add(data);
                    return true;
                })
        );

        assertEquals("data: ".length() + maximum + 1, input.position());
        assertTrue(events.isEmpty());
    }

    @Test
    void consumerCanStopBeforeFollowingBytesAreRead() throws Exception {
        var input = new PositionInputStream(
                "data: first\n\ndata: second\n\n".getBytes(StandardCharsets.US_ASCII)
        );
        var events = new ArrayList<String>();

        SseDecoder.decode(input, 16, Long.MAX_VALUE, data -> {
            events.add(data);
            return false;
        });

        assertEquals(List.of("first"), events);
        assertTrue(input.position() < input.sourceLength());
    }

    @Test
    void unknownFieldsRemainFailClosed() {
        for (String field : List.of(
                "event: message\n\n",
                "id: ignored\n\n",
                "retry: 1000\n\n"
        )) {
            assertThrows(
                    OpenAiCodecException.class,
                    () -> decode(field.getBytes(StandardCharsets.US_ASCII), 32)
            );
        }
    }

    @Test
    void rawBudgetMustBePositive() {
        for (long maximumRawBytes : List.of(0L, -1L)) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> SseDecoder.decode(
                            new ByteArrayInputStream(new byte[0]),
                            1,
                            maximumRawBytes,
                            data -> true
                    )
            );
        }
    }

    @Test
    void rawBudgetCountsCommentsBlankDataAndEveryLineEndingByte() throws Exception {
        for (String frame : List.of(
                ": keepalive\n\n",
                "\n",
                "data:\r\n\r\n",
                "data: ok\r\r"
        )) {
            byte[] accepted = frame.getBytes(StandardCharsets.US_ASCII);
            var exactEvents = new ArrayList<String>();
            decode(accepted, 64, accepted.length, exactEvents);
            if (frame.startsWith("data:")) {
                assertEquals(
                        List.of(frame.contains("ok") ? "ok" : ""),
                        exactEvents
                );
            } else {
                assertTrue(exactEvents.isEmpty());
            }

            var oneOver = new PositionInputStream(concat(
                    accepted,
                    bytes("X"),
                    bytes("SENTINEL")
            ));
            assertThrows(
                    OpenAiCodecException.class,
                    () -> SseDecoder.decode(
                            oneOver,
                            64,
                            accepted.length,
                            data -> true
                    )
            );
            assertEquals(accepted.length + 1, oneOver.position());
        }
    }

    @Test
    void rawBudgetDoesNotResetAfterDispatchedData() {
        byte[] accepted = "data: first\n\n: keepalive\r\n\r\n"
                .getBytes(StandardCharsets.US_ASCII);
        var input = new PositionInputStream(concat(
                accepted,
                bytes("X"),
                bytes("SENTINEL")
        ));
        var events = new ArrayList<String>();

        assertThrows(
                OpenAiCodecException.class,
                () -> SseDecoder.decode(input, 32, accepted.length, data -> {
                    events.add(data);
                    return true;
                })
        );

        assertEquals(List.of("first"), events);
        assertEquals(accepted.length + 1, input.position());
    }

    private static List<String> decode(byte[] payload, int maximumEventBytes) throws Exception {
        var events = new ArrayList<String>();
        decode(payload, maximumEventBytes, events);
        return events;
    }

    private static void decode(byte[] payload, int maximumEventBytes, List<String> events)
            throws Exception {
        SseDecoder.decode(
                new ByteArrayInputStream(payload),
                maximumEventBytes,
                Long.MAX_VALUE,
                data -> {
                    events.add(data);
                    return true;
                }
        );
    }

    private static void decode(
            byte[] payload,
            int maximumEventBytes,
            long maximumRawBytes,
            List<String> events
    ) throws Exception {
        SseDecoder.decode(
                new ByteArrayInputStream(payload),
                maximumEventBytes,
                maximumRawBytes,
                data -> {
                    events.add(data);
                    return true;
                }
        );
    }

    private static byte[] event(String payload, String lineEnding) {
        return ("data: " + payload + lineEnding + lineEnding).getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.US_ASCII);
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

    private static final class PositionInputStream extends InputStream {

        private final byte[] source;
        private int position;

        private PositionInputStream(byte[] source) {
            this.source = source;
        }

        @Override
        public int read() {
            if (position == source.length) {
                return -1;
            }
            return source[position++];
        }

        private int position() {
            return position;
        }

        private int sourceLength() {
            return source.length;
        }
    }
}
