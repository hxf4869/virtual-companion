package com.virtualcompanion.modelanthropic;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BoundedInputStreamTest {

    @Test
    void bulkReadHonorsOffsetAndDoesNotOverwriteSentinels() throws Exception {
        var source = new TrackingInputStream(bytes("abcdef"));
        var bounded = new BoundedInputStream(source, 4);
        byte[] destination = bytes("ZZZZZZZZ");

        assertEquals(4, bounded.read(destination, 2, 5));
        assertArrayEquals(bytes("ZZabcdZZ"), destination);
        assertEquals(4, source.lastBulkRequest());

        assertThrows(IOException.class, bounded::read);
        assertEquals(5, source.position());
    }

    @Test
    void oneOverflowProbeIsRememberedWithoutReadingAgain() throws Exception {
        var source = new TrackingInputStream(bytes("abcde"));
        var bounded = new BoundedInputStream(source, 4);
        byte[] destination = new byte[8];

        assertEquals(4, bounded.read(destination));
        assertThrows(IOException.class, bounded::read);
        int positionAfterProbe = source.position();
        int singleReadsAfterProbe = source.singleReadCalls();

        assertThrows(IOException.class, () -> bounded.read(destination, 1, 6));
        assertEquals(positionAfterProbe, source.position());
        assertEquals(singleReadsAfterProbe, source.singleReadCalls());
        assertEquals(0, bounded.available());
    }

    @Test
    void exactEofIsValidAndSubsequentReadsRemainAtEof() throws Exception {
        var source = new TrackingInputStream(bytes("abcd"));
        var bounded = new BoundedInputStream(source, 4);
        byte[] destination = new byte[8];

        assertEquals(4, bounded.read(destination));
        assertEquals(-1, bounded.read());
        assertEquals(-1, bounded.read(destination, 1, 6));
        assertEquals(0, bounded.skip(10));
        assertEquals(0, bounded.available());
        assertEquals(1, source.singleReadCalls());
    }

    @Test
    void availableTracksRemainingBudgetAndNeverExposesMoreThanFence() throws Exception {
        var source = new TrackingInputStream(bytes("abcdef"));
        var bounded = new BoundedInputStream(source, 4);

        assertEquals(4, bounded.available());
        assertEquals('a', bounded.read());
        assertEquals(3, bounded.available());
        assertEquals(2, bounded.skip(2));
        assertEquals(1, bounded.available());
        assertEquals('d', bounded.read());
        assertEquals(0, bounded.available());
    }

    @Test
    void skipNeverRequestsOrConsumesPastFence() throws Exception {
        var source = new TrackingInputStream(bytes("abcdef"));
        var bounded = new BoundedInputStream(source, 4);

        assertEquals(4, bounded.skip(10));
        assertEquals(4, source.position());
        assertEquals(4, source.lastSkipRequest());
        assertThrows(IOException.class, () -> bounded.skip(10));
        assertEquals(5, source.position());
        assertThrows(IOException.class, () -> bounded.skip(1));
        assertEquals(5, source.position());
    }

    @Test
    void skipAtExactEofConfirmsEofWithoutOverflow() throws Exception {
        var source = new TrackingInputStream(bytes("abcd"));
        var bounded = new BoundedInputStream(source, 4);

        assertEquals(4, bounded.skip(10));
        assertEquals(0, bounded.skip(1));
        assertEquals(-1, bounded.read());
        assertEquals(4, source.position());
    }

    @Test
    void markAndResetAreDisabled() throws Exception {
        var bounded = new BoundedInputStream(new TrackingInputStream(bytes("abc")), 3);

        assertFalse(bounded.markSupported());
        bounded.mark(10);
        assertThrows(IOException.class, bounded::reset);
    }

    @Test
    void zeroLengthReadDoesNotProbeOrConsume() throws Exception {
        var source = new TrackingInputStream(bytes("abc"));
        var bounded = new BoundedInputStream(source, 0);
        byte[] destination = bytes("ZZZ");

        assertEquals(0, bounded.read(destination, 1, 0));
        assertEquals(0, source.position());
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.US_ASCII);
    }

    private static final class TrackingInputStream extends InputStream {

        private final byte[] source;
        private int position;
        private int singleReadCalls;
        private int lastBulkRequest;
        private long lastSkipRequest;

        private TrackingInputStream(byte[] source) {
            this.source = source;
        }

        @Override
        public int read() {
            singleReadCalls++;
            if (position == source.length) {
                return -1;
            }
            return source[position++];
        }

        @Override
        public int read(byte[] bytes, int offset, int length) {
            lastBulkRequest = length;
            if (position == source.length) {
                return -1;
            }
            int count = Math.min(length, source.length - position);
            System.arraycopy(source, position, bytes, offset, count);
            position += count;
            return count;
        }

        @Override
        public long skip(long count) {
            lastSkipRequest = count;
            long skipped = Math.min(count, source.length - position);
            position += (int) skipped;
            return skipped;
        }

        @Override
        public int available() {
            return source.length - position;
        }

        private int position() {
            return position;
        }

        private int singleReadCalls() {
            return singleReadCalls;
        }

        private int lastBulkRequest() {
            return lastBulkRequest;
        }

        private long lastSkipRequest() {
            return lastSkipRequest;
        }
    }
}
