package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class FeishuAppBotDeliveryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Instant OCCURRED_AT = Instant.parse("2026-08-24T00:00:00Z");

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void obtainsTenantTokenSendsTextAndCachesToken() throws Exception {
        AtomicInteger tokenHits = new AtomicInteger();
        AtomicInteger messageHits = new AtomicInteger();
        AtomicReference<String> tokenBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> query = new AtomicReference<>();
        List<String> messageBodies = new CopyOnWriteArrayList<>();
        server = server();
        server.createContext("/token", exchange -> {
            tokenHits.incrementAndGet();
            tokenBody.set(readBody(exchange));
            respond(exchange, 200,
                    "{\"code\":0,\"tenant_access_token\":\"t-test-token\",\"expire\":7200}");
        });
        server.createContext("/messages", exchange -> {
            messageHits.incrementAndGet();
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            query.set(exchange.getRequestURI().getQuery());
            messageBodies.add(readBody(exchange));
            respond(exchange, 200,
                    "{\"code\":0,\"msg\":\"success\","
                            + "\"data\":{\"message_id\":\"om-test\"}}");
        });
        server.start();
        WebhookDelivery delivery = appDelivery(appProps("app-secret"));

        assertThat(delivery.isConfigured()).isTrue();
        assertThat(delivery.post(
                "P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", OCCURRED_AT,
                "vca-42-1787529600000"))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);
        assertThat(delivery.post(
                "P2", "PROVIDER_CIRCUIT_OPEN", "supplier unavailable", OCCURRED_AT,
                "vca-42-1787529600000"))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);

        assertThat(tokenHits.get()).isEqualTo(1);
        assertThat(messageHits.get()).isEqualTo(2);
        JsonNode tokenJson = MAPPER.readTree(tokenBody.get());
        assertThat(tokenJson.path("app_id").asText()).isEqualTo("cli_test");
        assertThat(tokenJson.path("app_secret").asText()).isEqualTo("app-secret");
        assertThat(authorization.get()).isEqualTo("Bearer t-test-token");
        assertThat(query.get()).isEqualTo("receive_id_type=chat_id");

        JsonNode firstMessage = MAPPER.readTree(messageBodies.getFirst());
        assertThat(firstMessage.path("receive_id").asText()).isEqualTo("oc_test_chat");
        assertThat(firstMessage.path("msg_type").asText()).isEqualTo("text");
        assertThat(firstMessage.path("uuid").asText()).isEqualTo("vca-42-1787529600000");
        JsonNode content = MAPPER.readTree(firstMessage.path("content").asText());
        assertThat(content.path("text").asText())
                .contains("Virtual Companion 告警")
                .contains("code=PROVIDER_CIRCUIT_OPEN")
                .contains("message=supplier unavailable");
        assertThat(messageBodies).allSatisfy(body -> assertThat(body)
                .doesNotContain("app-secret")
                .doesNotContain("t-test-token"));
        assertThat(MAPPER.readTree(messageBodies.get(1)).path("uuid").asText())
                .isEqualTo(firstMessage.path("uuid").asText());
    }

    @Test
    void missingAppCredentialDisablesAndRefusesWithoutNetwork() {
        AlertProperties properties = appProps("");
        WebhookDelivery delivery = new WebhookDelivery(
                properties,
                WebhookEgressPolicy.parse(""),
                EgressDnsGuard.defaults(),
                URI.create("http://127.0.0.1:1/token"),
                URI.create("http://127.0.0.1:1/messages?receive_id_type=chat_id"),
                Clock.systemUTC());

        assertThat(delivery.isConfigured()).isFalse();
        assertThat(delivery.post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
    }

    @Test
    void refusesInvalidCredentialResponseWithoutSendingMessage() throws Exception {
        AtomicInteger messageHits = new AtomicInteger();
        server = server();
        server.createContext("/token", exchange -> respond(
                exchange, 200, "{\"code\":20002,\"msg\":\"app mismatch\"}"));
        server.createContext("/messages", exchange -> {
            messageHits.incrementAndGet();
            respond(exchange, 200,
                    "{\"code\":0,\"data\":{\"message_id\":\"om-test\"}}");
        });
        server.start();

        assertThat(appDelivery(appProps("app-secret"))
                .post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
        assertThat(messageHits.get()).isZero();
    }

    @Test
    void classifiesMessageBusinessOutcomes() throws Exception {
        AtomicReference<String> response = new AtomicReference<>(
                "{\"code\":230020,\"msg\":\"rate limited\"}");
        server = server();
        server.createContext("/token", exchange -> respond(exchange, 200,
                "{\"code\":0,\"tenant_access_token\":\"t-token\",\"expire\":7200}"));
        server.createContext("/messages", exchange -> respond(exchange, 400, response.get()));
        server.start();
        WebhookDelivery delivery = appDelivery(appProps("app-secret"));

        assertThat(delivery.post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.RETRYABLE);
        response.set("{\"code\":230027,\"msg\":\"permission denied\"}");
        assertThat(delivery.post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.REFUSED);
    }

    @Test
    void invalidTenantTokenIsClearedBeforeRetry() throws Exception {
        AtomicInteger tokenHits = new AtomicInteger();
        AtomicInteger messageHits = new AtomicInteger();
        server = server();
        server.createContext("/token", exchange -> {
            int attempt = tokenHits.incrementAndGet();
            respond(exchange, 200,
                    "{\"code\":0,\"tenant_access_token\":\"t-token-" + attempt
                            + "\",\"expire\":7200}");
        });
        server.createContext("/messages", exchange -> {
            int attempt = messageHits.incrementAndGet();
            if (attempt == 1) {
                respond(exchange, 400,
                        "{\"code\":99991663,\"msg\":\"invalid token\"}");
            } else {
                assertThat(exchange.getRequestHeaders().getFirst("Authorization"))
                        .isEqualTo("Bearer t-token-2");
                respond(exchange, 200,
                        "{\"code\":0,\"data\":{\"message_id\":\"om-test\"}}");
            }
        });
        server.start();
        WebhookDelivery delivery = appDelivery(appProps("app-secret"));

        assertThat(delivery.post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.RETRYABLE);
        assertThat(delivery.post("P2", "X", "m", OCCURRED_AT))
                .isEqualTo(WebhookDelivery.Outcome.DELIVERED);
        assertThat(tokenHits.get()).isEqualTo(2);
        assertThat(messageHits.get()).isEqualTo(2);
    }

    private WebhookDelivery appDelivery(AlertProperties properties) {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        return new WebhookDelivery(
                properties,
                WebhookEgressPolicy.parse(""),
                EgressDnsGuard.defaults(),
                URI.create(base + "/token"),
                URI.create(base + "/messages?receive_id_type=chat_id"),
                Clock.fixed(Instant.parse("2026-08-24T01:00:00Z"), ZoneOffset.UTC));
    }

    private static AlertProperties appProps(String appSecret) {
        return new AlertProperties(
                "", "feishu-app-bot", Duration.ofSeconds(2), 60_000L, 24L, 1L,
                "", "cli_test", appSecret, "oc_test_chat", "", 5, 5);
    }

    private static HttpServer server() throws IOException {
        return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange exchange, int status, String responseBody)
            throws IOException {
        byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
