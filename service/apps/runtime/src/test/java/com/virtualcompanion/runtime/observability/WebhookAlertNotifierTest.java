package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * METRICS-ALERT: the webhook sink is fire-and-forget — a blank URL disables
 * it, delivery failures never throw into the business path, and identical
 * codes are throttled.
 */
class WebhookAlertNotifierTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private WebhookAlertNotifier notifier(String url) {
        return new WebhookAlertNotifier(
                new AlertProperties(url, Duration.ofSeconds(2), 60_000L, 24L, 1L));
    }

    @Test
    void blankUrlDisablesPostingWithoutError() {
        assertThatCode(() -> notifier("  ").alert(AlertSeverity.P1, "X", "m"))
                .doesNotThrowAnyException();
    }

    @Test
    void postsJsonPayloadToConfiguredUrl() throws Exception {
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";

        notifier(url).alert(AlertSeverity.P2, "DAU_CAP_REACHED", "test message");

        long deadline = System.currentTimeMillis() + 5_000;
        while (hits.get() == 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        assertThat(hits.get()).isEqualTo(1);
    }

    @Test
    void identicalCodesAreThrottledButDistinctCodesPass() throws Exception {
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookAlertNotifier n = notifier(url);

        n.alert(AlertSeverity.P2, "SAME_CODE", "a");
        n.alert(AlertSeverity.P2, "SAME_CODE", "b");
        n.alert(AlertSeverity.P1, "OTHER_CODE", "c");

        long deadline = System.currentTimeMillis() + 5_000;
        while (hits.get() < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        Thread.sleep(100);
        assertThat(hits.get()).isEqualTo(2);
    }

    @Test
    void unreachableEndpointNeverThrows() {
        // Port 1 is reserved and refuses connections; delivery failure must
        // surface only as a WARN log, never an exception.
        WebhookAlertNotifier n = notifier("http://127.0.0.1:1/hook");
        assertThatCode(() -> n.alert(AlertSeverity.P0, "X", "m"))
                .doesNotThrowAnyException();
    }
}
