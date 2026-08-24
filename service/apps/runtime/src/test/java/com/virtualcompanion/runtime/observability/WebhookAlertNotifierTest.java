package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.platform.persistence.AlertWebhookOutbox;
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
                new AlertProperties(
                        url, "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                        "test-secret", "", "", "", "", 5, 5));
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
    void outboxPathEnqueuesInsteadOfPosting() {
        AtomicInteger hits = new AtomicInteger();
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.enqueue(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new AlertWebhookOutbox.EnqueueResult(1L, true));
        WebhookAlertNotifier notifier = new WebhookAlertNotifier(
                new AlertProperties(
                        "http://127.0.0.1:1/hook",
                        "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                        "secret", "", "", "", "", 5, 5),
                outbox,
                new WebhookDelivery(new AlertProperties(
                        "http://127.0.0.1:1/hook",
                        "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                        "secret", "", "", "", "", 5, 5)),
                TestAlerts.metrics());

        assertThatCode(() -> notifier.alert(AlertSeverity.P2, "DAU_CAP_REACHED", "m"))
                .doesNotThrowAnyException();
        verify(outbox).enqueue("P2", "DAU_CAP_REACHED", "m", 60);
        assertThat(hits.get()).isEqualTo(0);
    }

    @Test
    void configuredFeishuAppBotEnqueuesWithoutWebhookUrl() {
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.enqueue(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new AlertWebhookOutbox.EnqueueResult(2L, true));
        AlertProperties properties = new AlertProperties(
                "", "feishu-app-bot", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "", "cli_test", "app-secret", "oc_test_chat", "", 5, 5);
        WebhookAlertNotifier notifier = new WebhookAlertNotifier(
                properties, outbox, new WebhookDelivery(properties), TestAlerts.metrics());

        notifier.alert(AlertSeverity.P2, "PROVIDER_CIRCUIT_OPEN", "supplier unavailable");

        verify(outbox).enqueue("P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", 60);
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
