package com.virtualcompanion.modelruntime.contract;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Utf8ByteAccumulatorTest {

    @Test
    void asciiAndNonBmpExactAndOneOver() {
        var ascii = new Utf8ByteAccumulator(3);
        assertTrue(ascii.tryAppend("abc"));
        assertEquals(3, ascii.bytes());
        assertFalse(ascii.tryAppend("d"));
        assertEquals(3, ascii.bytes());

        var nonBmp = new Utf8ByteAccumulator(4);
        assertTrue(nonBmp.tryAppend("🙂"));
        assertEquals(4, nonBmp.bytes());
        assertFalse(nonBmp.tryAppend("a"));
        assertEquals(4, nonBmp.bytes());
    }

    @Test
    void splitPairExactAndOneOverAreAtomic() {
        var exact = new Utf8ByteAccumulator(4);
        assertTrue(exact.tryAppend("\uD83D"));
        assertEquals(1, exact.bytes());
        assertTrue(exact.tryAppend("\uDE42"));
        assertEquals(4, exact.bytes());

        var oneOver = new Utf8ByteAccumulator(3);
        assertTrue(oneOver.tryAppend("\uD83D"));
        assertFalse(oneOver.tryAppend("\uDE42"));
        assertEquals(1, oneOver.bytes());
        assertTrue(oneOver.tryAppend(""));
        assertEquals(1, oneOver.bytes());
        assertFalse(oneOver.tryAppend("\uDE42"));
        assertEquals(1, oneOver.bytes());
    }

    @Test
    void multipleSplitPairsDoNotDrift() {
        var accumulator = new Utf8ByteAccumulator(8);
        assertTrue(accumulator.tryAppend("\uD83D"));
        assertTrue(accumulator.tryAppend("\uDE42\uD83D"));
        assertTrue(accumulator.tryAppend("\uDE43"));
        assertEquals(8, accumulator.bytes());
        assertEquals(
                SizeLimits.utf8Bytes("🙂🙃"),
                accumulator.bytes()
        );
    }

    @Test
    void emptyChunkPreservesPendingHighSurrogate() {
        var accumulator = new Utf8ByteAccumulator(4);
        assertTrue(accumulator.tryAppend("\uD83D"));
        assertTrue(accumulator.tryAppend(""));
        assertTrue(accumulator.tryAppend("\uDE42"));
        assertEquals(4, accumulator.bytes());
    }

    @Test
    void isolatedAndContinuousSurrogatesMatchCompleteStringSemantics() {
        assertMatches("\uD83D");
        assertMatches("\uDE42");
        assertMatches("\uD83D", "a");
        assertMatches("\uD83D", "\uD83D", "\uDE42");
        assertMatches("a", "\uDE42", "b", "\uD83D", "c");
    }

    @Test
    void nullChunkAndNegativeMaximumAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> new Utf8ByteAccumulator(-1));
        var accumulator = new Utf8ByteAccumulator(4);
        assertThrows(NullPointerException.class, () -> accumulator.tryAppend(null));
        assertEquals(0, accumulator.bytes());
    }

    private static void assertMatches(String... chunks) {
        var accumulator = new Utf8ByteAccumulator(100);
        var combined = new StringBuilder();
        for (String chunk : chunks) {
            assertTrue(accumulator.tryAppend(chunk));
            combined.append(chunk);
            assertEquals(SizeLimits.utf8Bytes(combined.toString()), accumulator.bytes());
        }
    }
}
