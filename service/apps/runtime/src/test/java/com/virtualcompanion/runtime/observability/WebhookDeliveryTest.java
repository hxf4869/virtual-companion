package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
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
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookDelivery delivery = new WebhookDelivery(props(url, "generic", ""));

        assertThat(delivery.post("P2", "DAU_CAP_REACHED", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        WebhookDelivery feishu = new WebhookDelivery(props(url, "feishu-custom-bot", ""));
        assertThat(feishu.post("P2", "DAU_CAP_REACHED", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        assertThat(hits.get()).isEqualTo(0);
    }

    @Test
    void privateLiteralIsRefused() {
        WebhookDelivery delivery = new WebhookDelivery(
                props("https://169.254.169.254/latest", "generic", "secret"));
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
        WebhookDelivery delivery = new WebhookDelivery(props(url, "generic", "test-secret"));
        Instant occurred = Instant.parse("2026-08-23T00:00:00Z");

        assertThat(delivery.post("P2", "DAU_CAP_REACHED", "daily cap", occurred))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);
        assertThat(body.get()).contains("DAU_CAP_REACHED");
        assertThat(signature.get()).isEqualTo(
                "sha256=" + WebhookDelivery.sign("test-secret", body.get()));
    }

    @Test
    void signsFeishuAccordingToProtocolVector() throws Exception {
        assertThat(WebhookDelivery.signFeishu("feishu-test-secret", 1_599_360_473L))
                .isEqualTo("7Gq8ROqhtzskcbk2fAPXpWnrRaTUDD2iIHvbmt3/cuo=");
    }

    @Test
    void signsAndDeliversFeishuTextPayload() throws Exception {
        AtomicReference<String> genericSignature = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            genericSignature.set(exchange.getRequestHeaders().getFirst("X-VC-Signature"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "{\"code\":0,\"msg\":\"success\"}");
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        String secret = "feishu-signing-secret";
        WebhookDelivery delivery = new WebhookDelivery(
                props(url, "feishu-custom-bot", secret));
        Instant occurred = Instant.parse("2026-08-23T00:00:00Z");
        long startedAt = Instant.now().getEpochSecond();

        assertThat(delivery.post("P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", occurred))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);

        long finishedAt = Instant.now().getEpochSecond();
        JsonNode json = new ObjectMapper().readTree(body.get());
        long timestamp = Long.parseLong(json.path("timestamp").asText());
        assertThat(timestamp).isBetween(startedAt, finishedAt);
        assertThat(json.path("sign").asText())
                .isEqualTo(WebhookDelivery.signFeishu(secret, timestamp));
        assertThat(json.path("msg_type").asText()).isEqualTo("text");
        assertThat(json.path("content").path("text").asText())
                .contains("Virtual Companion 告警")
                .contains("severity=P2")
                .contains("code=PROVIDER_CIRCUIT_OPEN")
                .contains("message=supplier unavailable")
                .contains("occurredAt=2026-08-23T00:00:00Z");
        assertThat(genericSignature.get()).isNull();
        assertThat(body.get()).doesNotContain(secret);
    }

    @Test
    void acceptsLegacyFeishuSuccessResponse() throws Exception {
        String url = startRespondingServer(200,
                "{\"StatusCode\":0,\"StatusMessage\":\"success\"}");
        WebhookDelivery delivery = new WebhookDelivery(
                props(url, "feishu-custom-bot", "secret"));

        assertThat(delivery.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);
    }

    @Test
    void refusesFeishuBusinessFailureEvenOnHttp200() throws Exception {
        String url = startRespondingServer(200,
                "{\"code\":19021,\"msg\":\"sign match fail\"}");
        WebhookDelivery delivery = new WebhookDelivery(
                props(url, "feishu-custom-bot", "secret"));

        assertThat(delivery.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
    }

    @Test
    void refusesConflictingFeishuBusinessCodes() throws Exception {
        String url = startRespondingServer(200,
                "{\"code\":0,\"StatusCode\":19021,\"msg\":\"sign match fail\"}");
        WebhookDelivery delivery = new WebhookDelivery(
                props(url, "feishu-custom-bot", "secret"));

        assertThat(delivery.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
    }

    @Test
    void retriesFeishuBusinessRateLimitAndMalformedSuccess() throws Exception {
        String rateLimitedUrl = startRespondingServer(200,
                "{\"code\":11232,\"msg\":\"rate limited\"}");
        WebhookDelivery rateLimited = new WebhookDelivery(
                props(rateLimitedUrl, "feishu-custom-bot", "secret"));

        assertThat(rateLimited.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.RETRYABLE);

        server.stop(0);
        server = null;
        String malformedUrl = startRespondingServer(200, "not-json");
        WebhookDelivery malformed = new WebhookDelivery(
                props(malformedUrl, "feishu-custom-bot", "secret"));

        assertThat(malformed.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.RETRYABLE);
    }

    @Test
    void classifiesFeishuHttpFailures() throws Exception {
        String refusedUrl = startRespondingServer(400, "{}");
        WebhookDelivery refused = new WebhookDelivery(
                props(refusedUrl, "feishu-custom-bot", "secret"));

        assertThat(refused.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);

        server.stop(0);
        server = null;
        String retryUrl = startRespondingServer(429, "{}");
        WebhookDelivery retry = new WebhookDelivery(
                props(retryUrl, "feishu-custom-bot", "secret"));

        assertThat(retry.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.RETRYABLE);
    }

    @Test
    void refusesOversizedFeishuPayloadWithoutPosting() throws Exception {
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.incrementAndGet();
            respond(exchange, 200, "{\"code\":0}");
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookDelivery delivery = new WebhookDelivery(
                props(url, "feishu-custom-bot", "secret"));

        assertThat(delivery.post("P2", "X", "x".repeat(21 * 1024), Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        assertThat(hits.get()).isZero();
    }

    @Test
    void unsupportedProviderRefusesWithoutPosting() throws Exception {
        AtomicInteger hits = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            hits.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
        WebhookDelivery delivery = new WebhookDelivery(props(url, "unknown", "secret"));

        assertThat(delivery.post("P2", "X", "m", Instant.now()))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        assertThat(hits.get()).isZero();
    }

    private String startRespondingServer(int status, String responseBody) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> respond(exchange, status, responseBody));
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
    }

    private static void respond(
            com.sun.net.httpserver.HttpExchange exchange,
            int status,
            String responseBody) throws java.io.IOException {
        byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static AlertProperties props(String url, String provider, String secret) {
        return new AlertProperties(
                url, provider, Duration.ofSeconds(2), 60_000L, 24L, 1L,
                secret, "", "", "", "", 5, 5);
    }
}
