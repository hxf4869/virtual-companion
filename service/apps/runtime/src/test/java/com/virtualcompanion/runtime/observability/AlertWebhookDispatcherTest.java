package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.platform.persistence.AlertWebhookOutbox;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AlertWebhookDispatcherTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void drainCompletesDeliveredOn2xx() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        AlertProperties properties = new AlertProperties(
                url, "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "secret", "", "", "", "", 5, 5);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(16)).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                11L, "P2", "DAU_CAP_REACHED", "daily cap", Instant.now(), 1)));
        when(outbox.complete(eq(11L), eq("DELIVERED"), eq(""), eq(5), eq(5))).thenReturn(true);

        new AlertWebhookDispatcher(outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics())
                .drain();

        verify(outbox).complete(11L, "DELIVERED", "", 5, 5);
    }

    @Test
    void drainDeadLettersRefusedPrivateUrl() {
        AlertProperties properties = new AlertProperties(
                "https://169.254.169.254/latest",
                "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "secret", "", "", "", "", 5, 5);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(anyInt())).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                12L, "P0", "X", "m", Instant.now(), 1)));

        new AlertWebhookDispatcher(outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics())
                .drain();

        verify(outbox).complete(12L, "DEAD", "refused", 5, 5);
    }

    @Test
    void drainCompletesDeliveredForFeishuBusinessSuccess() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> respond(exchange, "{\"code\":0}"));
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        AlertProperties properties = new AlertProperties(
                url, "feishu-custom-bot", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "secret", "", "", "", "", 5, 5);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(16)).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                13L, "P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", Instant.now(), 1)));
        when(outbox.complete(eq(13L), eq("DELIVERED"), eq(""), eq(5), eq(5))).thenReturn(true);

        new AlertWebhookDispatcher(outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics())
                .drain();

        verify(outbox).complete(13L, "DELIVERED", "", 5, 5);
    }

    @Test
    void drainDeadLettersFeishuBusinessFailure() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> respond(exchange, "{\"code\":19021}"));
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        AlertProperties properties = new AlertProperties(
                url, "feishu-custom-bot", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "secret", "", "", "", "", 5, 5);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(16)).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                14L, "P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", Instant.now(), 1)));

        new AlertWebhookDispatcher(outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics())
                .drain();

        verify(outbox).complete(14L, "DEAD", "refused", 5, 5);
    }

    @Test
    void retryableShortOutageRecoversOnTheNextClaim() throws Exception {
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            int status = hits.getAndIncrement() == 0 ? 503 : 204;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        AlertProperties properties = new AlertProperties(
                url, "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "secret", "", "", "", "", 5, 1);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        AlertWebhookOutbox.Claimed first = new AlertWebhookOutbox.Claimed(
                21L, "P1", "DAU_METRICS_FAILED", "aggregate refresh failed", Instant.now(), 1);
        AlertWebhookOutbox.Claimed second = new AlertWebhookOutbox.Claimed(
                21L, "P1", "DAU_METRICS_FAILED", "aggregate refresh failed",
                first.occurredAt(), 2);
        when(outbox.claim(16)).thenReturn(List.of(first), List.of(second));
        when(outbox.complete(eq(21L), eq("RETRY"), eq("retryable"), eq(5), eq(1)))
                .thenReturn(true);
        when(outbox.complete(eq(21L), eq("DELIVERED"), eq(""), eq(5), eq(1)))
                .thenReturn(true);
        AlertWebhookDispatcher dispatcher = new AlertWebhookDispatcher(
                outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics());

        dispatcher.drain();
        dispatcher.drain();

        assertThat(hits.get()).isEqualTo(2);
        verify(outbox).complete(21L, "RETRY", "retryable", 5, 1);
        verify(outbox).complete(21L, "DELIVERED", "", 5, 1);
    }

    @Test
    void fallbackWebhookDeliversWhenPrimaryIsUnavailable() throws Exception {
        AtomicInteger primaryHits = new AtomicInteger();
        AtomicInteger fallbackHits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/primary", exchange -> {
            primaryHits.incrementAndGet();
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.createContext("/fallback", exchange -> {
            fallbackHits.incrementAndGet();
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        String root = "http://127.0.0.1:" + server.getAddress().getPort();
        AlertProperties properties = new AlertProperties(
                root + "/primary", "generic", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "primary-secret", "", "", "", "", 5, 5);
        FallbackWebhookDelivery fallback = new FallbackWebhookDelivery(
                new AlertFallbackProperties(
                        root + "/fallback", "fallback-secret", "", Duration.ofSeconds(2)));
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(16)).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                15L, "P0", "PROVIDER_DURABLE_ROLLBACK_FAILED",
                "durable rollback failed", Instant.now(), 1)));
        when(outbox.complete(eq(15L), eq("DELIVERED"), eq(""), eq(5), eq(5)))
                .thenReturn(true);

        new AlertWebhookDispatcher(
                outbox, new WebhookDelivery(properties), fallback, properties, TestAlerts.metrics())
                .drain();

        assertThat(primaryHits.get()).isEqualTo(1);
        assertThat(fallbackHits.get()).isEqualTo(1);
        verify(outbox).complete(15L, "DELIVERED", "", 5, 5);
    }

    private static void respond(
            com.sun.net.httpserver.HttpExchange exchange,
            String responseBody) throws java.io.IOException {
        byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
