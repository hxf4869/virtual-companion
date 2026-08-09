package com.virtualcompanion.modelopenai;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

/**
 * Input stream that consumes at most the configured bytes plus one overflow probe.
 */
final class BoundedInputStream extends FilterInputStream {

    private long remaining;
    private boolean endConfirmed;
    private boolean limitExceeded;

    BoundedInputStream(InputStream input, long maximumBytes) {
        super(Objects.requireNonNull(input, "input must not be null"));
        if (maximumBytes < 0) {
            throw new IllegalArgumentException("maximumBytes must not be negative");
        }
        this.remaining = maximumBytes;
    }

    @Override
    public int read() throws IOException {
        if (endConfirmed) {
            return -1;
        }
        if (remaining == 0) {
            return probeForOverflow();
        }
        int value = super.read();
        if (value >= 0) {
            remaining--;
        } else {
            endConfirmed = true;
        }
        return value;
    }

    @Override
    public int read(byte[] bytes, int offset, int length) throws IOException {
        Objects.checkFromIndexSize(offset, length, bytes.length);
        if (length == 0) {
            return 0;
        }
        if (endConfirmed) {
            return -1;
        }
        if (remaining == 0) {
            return probeForOverflow();
        }
        int boundedLength = (int) Math.min((long) length, remaining);
        int count = super.read(bytes, offset, boundedLength);
        if (count > 0) {
            remaining -= count;
        } else if (count < 0) {
            endConfirmed = true;
        }
        return count;
    }

    @Override
    public long skip(long count) throws IOException {
        if (count <= 0) {
            return 0;
        }
        if (endConfirmed) {
            return 0;
        }
        if (remaining == 0) {
            return probeForOverflow() < 0 ? 0 : 1;
        }
        long skipped = super.skip(Math.min(count, remaining));
        remaining -= skipped;
        return skipped;
    }

    @Override
    public int available() throws IOException {
        if (endConfirmed) {
            return 0;
        }
        return (int) Math.min((long) super.available(), remaining);
    }

    @Override
    public boolean markSupported() {
        return false;
    }

    @Override
    public synchronized void mark(int readLimit) {
        // Reset would make the byte budget ambiguous, so marking is unsupported.
    }

    @Override
    public synchronized void reset() throws IOException {
        throw new IOException("mark/reset is not supported");
    }

    private int probeForOverflow() throws IOException {
        if (limitExceeded) {
            throw new IOException("response body exceeds configured limit");
        }
        if (endConfirmed) {
            return -1;
        }
        int probe = super.read();
        if (probe < 0) {
            endConfirmed = true;
            return -1;
        }
        limitExceeded = true;
        throw new IOException("response body exceeds configured limit");
    }
}
