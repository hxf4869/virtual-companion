package com.virtualcompanion.modelanthropic;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
                AnthropicCodecException.class,
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
                AnthropicCodecException.class,
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
                AnthropicCodecException.class,
                () -> decode(event(oneOverPayload, "\n"), 4, events)
        );
        assertTrue(events.isEmpty());
    }

    @Test
    void commentsAreIgnoredButRemainIndividuallyBounded() throws Exception {
        var exact = ":xx\n\ndata: ok\n\n".getBytes(StandardCharsets.US_ASCII);
        var oneOver = new PositionInputStream(
                ":xxx\n\nSENTINEL".getBytes(StandardCharsets.US_ASCII)
        );

        assertEquals(List.of("ok"), decode(exact, 3));
        var events = new ArrayList<String>();
        assertThrows(
                AnthropicCodecException.class,
                () -> SseDecoder.decode(oneOver, 3, data -> {
                    events.add(data);
                    return true;
                })
        );
        assertEquals(4, oneOver.position());
        assertTrue(events.isEmpty());
    }

    @Test
    void explicitEventLinesAreIgnoredButIndividuallyBounded() throws Exception {
        var exact = ("event: xxx\n" + "data: ok\n\n").getBytes(StandardCharsets.US_ASCII);
        var oneOver = new PositionInputStream(
                "event: xxxx\nSENTINEL".getBytes(StandardCharsets.US_ASCII)
        );

        assertEquals(List.of("ok"), decode(exact, 3));
        var events = new ArrayList<String>();
        assertThrows(
                AnthropicCodecException.class,
                () -> SseDecoder.decode(oneOver, 3, data -> {
                    events.add(data);
                    return true;
                })
        );
        assertEquals("event: ".length() + 4, oneOver.position());
        assertTrue(events.isEmpty());
    }

    @Test
    void crlfAndCrFramingBothDispatchEvents() throws Exception {
        var payload = "data: one\r\n\r\ndata: two\r\r".getBytes(StandardCharsets.US_ASCII);

        assertEquals(List.of("one", "two"), decode(payload, 3));
    }

    @Test
    void eofFinishesFinalDataLineAndEmptyDataIsDelivered() throws Exception {
        assertEquals(List.of("eof"), decode(
                "data: eof".getBytes(StandardCharsets.US_ASCII),
                3));
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

        assertThrows(
                AnthropicCodecException.class,
                () -> decode(malformed, 8, events)
        );
        assertTrue(events.isEmpty());
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
                AnthropicCodecException.class,
                () -> SseDecoder.decode(input, maximum, data -> {
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

        SseDecoder.decode(input, 16, data -> {
            events.add(data);
            return false;
        });

        assertEquals(List.of("first"), events);
        assertTrue(input.position() < input.sourceLength());
    }

    @Test
    void unknownFieldFailsClosed() {
        assertThrows(
                AnthropicCodecException.class,
                () -> decode("id: ignored\n\n".getBytes(StandardCharsets.US_ASCII), 32)
        );
    }

    private static List<String> decode(byte[] payload, int maximumEventBytes) throws Exception {
        var events = new ArrayList<String>();
        decode(payload, maximumEventBytes, events);
        return events;
    }

    private static void decode(
            byte[] payload,
            int maximumEventBytes,
            List<String> events
    ) throws Exception {
        SseDecoder.decode(
                new ByteArrayInputStream(payload),
                maximumEventBytes,
                data -> {
                    events.add(data);
                    return true;
                }
        );
    }

    private static byte[] event(String payload, String lineEnding) {
        return ("data: " + payload + lineEnding + lineEnding)
                .getBytes(StandardCharsets.UTF_8);
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
