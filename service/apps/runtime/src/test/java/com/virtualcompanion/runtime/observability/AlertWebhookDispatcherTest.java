package com.virtualcompanion.runtime.observability;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.platform.persistence.AlertWebhookOutbox;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
                url, Duration.ofSeconds(2), 60_000L, 24L, 1L, "secret", "", 5, 5);
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
                Duration.ofSeconds(2), 60_000L, 24L, 1L, "secret", "", 5, 5);
        AlertWebhookOutbox outbox = mock(AlertWebhookOutbox.class);
        when(outbox.claim(anyInt())).thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                12L, "P0", "X", "m", Instant.now(), 1)));

        new AlertWebhookDispatcher(outbox, new WebhookDelivery(properties), properties, TestAlerts.metrics())
                .drain();

        verify(outbox).complete(12L, "DEAD", "refused", 5, 5);
    }
}
