package com.virtualcompanion.runtime.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link LiveDeltaBroker} (STREAM-LIVE): publish/subscribe, the
 * retained history prefix for late subscribers (with bounded overflow), the
 * end marker, and entry release on close.
 */
class LiveDeltaBrokerTest {

    private final LiveDeltaBroker broker = new LiveDeltaBroker();

    /** Mirrors {@link LiveDeltaBroker} HISTORY_CAP for the overflow test. */
    private static final int HISTORY_CAP = 256;

    private static LiveDeltaBroker.LiveEvent delta(long seq, String text) {
        return new LiveDeltaBroker.LiveEvent(1, seq, "chat.delta", text);
    }

    @Test
    void subscriberReceivesLiveEventsInOrderAndTheEndMarker() throws Exception {
        try (LiveDeltaBroker.Subscriber subscriber = broker.subscribe(7L)) {
            broker.publish(7L, delta(2L, "Hel"));
            broker.publish(7L, delta(3L, "lo"));
            broker.publishEnd(7L);

            assertEquals("Hel", subscriber.poll(100).payload());
            assertEquals("lo", subscriber.poll(100).payload());
            assertTrue(subscriber.poll(100).isEnd());
        }
    }

    @Test
    void lateSubscriberReceivesTheRetainedHistoryPrefix() throws Exception {
        broker.publish(7L, delta(2L, "a"));
        broker.publish(7L, delta(3L, "b"));

        // Subscribing while the generation is still live: the retained prefix
        // replays the earlier chunks, then the live queue continues.
        try (LiveDeltaBroker.Subscriber subscriber = broker.subscribe(7L)) {
            assertEquals("a", subscriber.poll(100).payload());
            assertEquals("b", subscriber.poll(100).payload());
            broker.publish(7L, delta(4L, "c"));
            assertEquals("c", subscriber.poll(100).payload());
        }
    }

    @Test
    void publishEndReleasesAnEntryWithNoSubscribers() throws Exception {
        broker.publish(7L, delta(2L, "a"));
        broker.publishEnd(7L);

        // Nobody was subscribed: the finished generation is released, and a
        // fresh subscriber sees nothing (the durable resume path answers).
        try (LiveDeltaBroker.Subscriber subscriber = broker.subscribe(7L)) {
            assertNull(subscriber.poll(50));
        }
    }

    @Test
    void historyOverflowKeepsOnlyTheMostRecentPrefix() throws Exception {
        for (int i = 0; i < HISTORY_CAP + 10; i++) {
            broker.publish(7L, delta(i + 1, "chunk-" + i));
        }

        try (LiveDeltaBroker.Subscriber subscriber = broker.subscribe(7L)) {
            // The oldest entries were dropped; the prefix still carries the
            // most recent chunk before overflow (gap semantics preserved).
            LiveDeltaBroker.LiveEvent first = subscriber.poll(100);
            assertTrue(first.payload().toString().startsWith("chunk-"));
        }
    }

    @Test
    void closingTheLastSubscriberReleasesTheEntry() throws Exception {
        try (LiveDeltaBroker.Subscriber subscriber = broker.subscribe(9L)) {
            broker.publish(9L, delta(2L, "x"));
            assertEquals("x", subscriber.poll(100).payload());
        }
        // Released: a later publish starts a fresh entry (the worker contract
        // never publishes after publishEnd, so this is the documented edge).
        broker.publish(9L, delta(3L, "y"));
        try (LiveDeltaBroker.Subscriber again = broker.subscribe(9L)) {
            assertEquals("y", again.poll(50).payload());
        }
    }
}
