package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class WebhookDeliveryTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void missingSecretRefusesWithoutPosting() throws Exception {
        AtomicReference<Integer> hits = new AtomicReference<>(0);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.set(hits.get() + 1);
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookDelivery delivery = new WebhookDelivery(props(url, ""));

        assertThat(delivery.post("P2", "DAU_CAP_REACHED", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        assertThat(hits.get()).isEqualTo(0);
    }

    @Test
    void privateLiteralIsRefused() {
        WebhookDelivery delivery = new WebhookDelivery(
                props("https://169.254.169.254/latest", "secret"));
        assertThat(delivery.post("P0", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
    }

    @Test
    void signsBodyAndDeliversToLoopback() throws Exception {
        AtomicReference<String> signature = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            signature.set(exchange.getRequestHeaders().getFirst("X-VC-Signature"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookDelivery delivery = new WebhookDelivery(props(url, "test-secret"));
        Instant occurred = Instant.parse("2026-08-23T00:00:00Z");

        assertThat(delivery.post("P2", "DAU_CAP_REACHED", "daily cap", occurred))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);
        assertThat(body.get()).contains("DAU_CAP_REACHED");
        assertThat(signature.get()).isEqualTo(
                "sha256=" + WebhookDelivery.sign("test-secret", body.get()));
    }

    private static AlertProperties props(String url, String secret) {
        return new AlertProperties(
                url, Duration.ofSeconds(2), 60_000L, 24L, 1L, secret, "", 5, 5);
    }
}
