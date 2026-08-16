package com.virtualcompanion.runtime.realtime;

import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Process-local live delta broker (STREAM-LIVE).
 *
 * <p>The generation worker publishes non-durable {@code chat.delta} chunks here
 * while the model session runs (single instance, Technical Alpha — mirroring
 * the process-local CANCEL-A pattern); the Fetch-SSE stream controller
 * subscribes while the generation is non-terminal and forwards the chunks to
 * the client. Deltas carry the stream (epoch, eventSeq) pair reserved through
 * {@code vc.advance_realtime_seq} in the worker's prepare segment — they
 * consume durable seq space without persisting (V8 semantics), so the client's
 * cursor stays contiguous and a reconnect is answered by the durable resume
 * path (missing deltas are never fabricated, INV-RT-001).
 *
 * <p>Best effort: a delta published before any subscriber exists is lost
 * (bounded per-generation history keeps a small prefix so a late subscriber
 * still receives the earlier chunks; overflow drops the oldest, which surfaces
 * as the client's sanctioned gap → snapshot recovery). {@code publishEnd} marks
 * the generation finished; the live stream completes and the client's next
 * resume attempt picks up the durable terminal event.
 */
public final class LiveDeltaBroker {

    /** One published live event: a delta chunk or the generation-finished marker. */
    public record LiveEvent(long streamEpoch, long eventSeq, String eventType, String payload) {

        public static LiveEvent end() {
            return new LiveEvent(-1, -1, END_TYPE, "");
        }

        public boolean isEnd() {
            return END_TYPE.equals(eventType);
        }
    }

    private static final String END_TYPE = "generation.finished";

    /** Bounded per-generation retention: the queue IS the retained prefix. */
    private static final int HISTORY_CAP = 256;

    /** Per-generation live queue and subscriber count. */
    private static final class Entry {
        final LinkedBlockingQueue<LiveEvent> queue = new LinkedBlockingQueue<>(HISTORY_CAP);
        int subscribers;
    }

    private final ConcurrentMap<Long, Entry> entries = new ConcurrentHashMap<>();

    /**
     * Publish one live event. The entry is created on demand so a late
     * subscriber still drains the retained prefix; the bounded queue drops the
     * oldest event when a generation out-publishes its consumers (the client's
     * sanctioned gap → snapshot recovery). Must never be called for a
     * generation after {@link #publishEnd} released its entry.
     */
    public void publish(long generationId, LiveEvent event) {
        Objects.requireNonNull(event, "event must not be null");
        Entry entry = entries.computeIfAbsent(generationId, ignored -> new Entry());
        entry.queue.offer(event);
    }

    /**
     * Mark the generation finished. When nobody is subscribed the entry is
     * released right away (a later stream finds the generation terminal and
     * completes via the durable resume path instead).
     */
    public void publishEnd(long generationId) {
        Entry entry = entries.get(generationId);
        if (entry == null) {
            return;
        }
        synchronized (entry) {
            if (entry.subscribers == 0) {
                entries.remove(generationId, entry);
                return;
            }
        }
        entry.queue.offer(LiveEvent.end());
    }

    /**
     * Subscribe to a generation's live events: first the retained prefix
     * (everything published so far, oldest first), then the live queue.
     * Close the subscriber to release the entry.
     */
    public Subscriber subscribe(long generationId) {
        Entry entry = entries.computeIfAbsent(
                generationId, ignored -> new Entry());
        synchronized (entry) {
            entry.subscribers += 1;
        }
        return new Subscriber(generationId, entry);
    }

    /** One live subscription; close it when the stream ends or times out. */
    public final class Subscriber implements AutoCloseable {

        private final long generationId;
        private final Entry entry;

        private Subscriber(long generationId, Entry entry) {
            this.generationId = generationId;
            this.entry = entry;
        }

        /**
         * Next live event, or {@code null} when nothing arrived within
         * {@code timeoutMillis} (the caller decides the tail deadline).
         */
        public LiveEvent poll(long timeoutMillis) throws InterruptedException {
            return entry.queue.poll(timeoutMillis, TimeUnit.MILLISECONDS);
        }

        /** Release this subscription; the entry is dropped with the last subscriber. */
        @Override
        public void close() {
            synchronized (entry) {
                entry.subscribers -= 1;
                if (entry.subscribers > 0) {
                    return;
                }
            }
            entries.remove(generationId, entry);
        }
    }
}
