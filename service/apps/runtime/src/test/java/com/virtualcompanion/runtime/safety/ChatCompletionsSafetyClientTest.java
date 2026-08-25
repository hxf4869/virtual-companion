package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.catalog.RiskLevel;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-04 (ADR-0006 §5): wire-level test against a local stub server.
 * Every malformed, conflicting or unavailable response must fail closed.
 */
class ChatCompletionsSafetyClientTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private void stub(String contentJson) throws Exception {
        stubWithStatus(200, contentJson);
    }

    private void stubWithStatus(int status, String contentJson) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] resp = ("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
                    + jsonString(contentJson) + "}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
    }

    /** A stub that captures the request body, then answers with the content JSON. */
    private void stubCapturingRequest(String contentJson) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            exchange.getRequestBody().transferTo(buffer);
            Captured.request = buffer.toByteArray();
            byte[] resp = ("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
                    + jsonString(contentJson) + "}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
    }

    private static final class Captured {
        static volatile byte[] request;
    }

    private static String jsonString(String raw) {
        return "\"" + raw.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private String stubUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    }

    @Test
    void classifiesCleanContentAndSendsAMinimalContextFreeRequest() throws Exception {
        stubCapturingRequest("{\"riskLevel\":\"R0_NORMAL\",\"confidence\":0.97,\"violations\":[]}");

        var result = new ChatCompletionsSafetyClient(stubUrl(), "test-model", "k")
                .classify("今天天气不错");

        assertEquals(RiskLevel.R0_NORMAL, result.riskLevel());
        assertEquals(List.of(), result.violations());
        assertEquals(0.97, result.confidence(), 0.0001);

        // DOGFOOD-04 (ADR-0006 §5.3): no persona/memory/session context, a
        // fixed system instruction, minimal output budget, JSON-only mode.
        JsonNode body = new ObjectMapper().readTree(new String(Captured.request, StandardCharsets.UTF_8));
        assertEquals("test-model", body.path("model").asText());
        assertEquals(128, body.path("max_tokens").asInt());
        assertEquals("json_object", body.path("response_format").path("type").asText());
        assertEquals(2, body.path("messages").size());
        assertEquals("system", body.path("messages").get(0).path("role").asText());
        assertEquals("user", body.path("messages").get(1).path("role").asText());
        assertEquals("今天天气不错", body.path("messages").get(1).path("content").asText());
        assertTrue(body.path("messages").get(0).path("content").asText().contains("riskLevel"));
        assertTrue(body.path("stream").isMissingNode());
    }

    @Test
    void classifiesFlaggedContent() throws Exception {
        stub("{\"riskLevel\":\"R3_HIGH\",\"confidence\":0.91,\"violations\":[\"violence\"]}");

        var result = new ChatCompletionsSafetyClient(stubUrl(), "test-model", "k")
                .classify("some text");

        assertEquals(RiskLevel.R3_HIGH, result.riskLevel());
        assertEquals(List.of("violence"), result.violations());
        assertEquals(0.91, result.confidence(), 0.0001);
    }

    @Test
    void transportFailureAndHttpErrorFailClosed() throws Exception {
        stubWithStatus(500, "{\"riskLevel\":\"R0_NORMAL\",\"confidence\":0.99,\"violations\":[]}");
        assertThrows(IllegalStateException.class, () ->
                new ChatCompletionsSafetyClient(stubUrl(), "test-model", "k").classify("x"));

        // Port 1 refuses connections: the same catch covers request timeouts.
        assertThrows(IllegalStateException.class, () ->
                new ChatCompletionsSafetyClient("http://127.0.0.1:1/v1", "m", "k").classify("x"));
    }

    @Test
    void nonJsonContentFailsClosed() throws Exception {
        stub("not json at all");
        // Mirrors the moderations client: a non-JSON payload is an
        // IllegalArgumentException; the composite still fails closed on it.
        assertThrows(IllegalArgumentException.class, () ->
                new ChatCompletionsSafetyClient(stubUrl(), "test-model", "k").classify("x"));
    }

    @Test
    void malformedPayloadsFailClosedInsteadOfClean() {
        // Missing riskLevel / confidence.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("{\"confidence\":0.9}")));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("{\"riskLevel\":\"R0_NORMAL\"}")));
        // Unknown riskLevel value.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("{\"riskLevel\":\"R9_Whatever\",\"confidence\":0.9}")));
        // Confidence out of range / wrong type.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("{\"riskLevel\":\"R0_NORMAL\",\"confidence\":1.5}")));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("{\"riskLevel\":\"R0_NORMAL\",\"confidence\":\"0.9\"}")));
        // Field conflict: R0 must carry no violations.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R0_NORMAL\",\"confidence\":0.9,"
                                + "\"violations\":[\"violence\"]}")));
        // Wrong violations type / non-string entries.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R3_HIGH\",\"confidence\":0.9,\"violations\":\"violence\"}")));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R3_HIGH\",\"confidence\":0.9,\"violations\":[7]}")));
        // DOGFOOD-STABILIZATION audit: violations is a required field — a
        // missing field or an explicit null is malformed, never "none".
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R3_HIGH\",\"confidence\":0.9}")));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R3_HIGH\",\"confidence\":0.9,\"violations\":null}")));
        // Unknown field: the content object must hold known fields only.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(completion(
                        "{\"riskLevel\":\"R0_NORMAL\",\"confidence\":0.9,\"note\":\"hi\"}")));
    }

    @Test
    void endpointOutsideTheEgressAllowlistFailsAtConstruction() {
        // defaults() allows only the approved supplier hosts + loopback, so a
        // random HTTPS host must be rejected before any request exists.
        assertThrows(IllegalArgumentException.class, () ->
                new ChatCompletionsSafetyClient(
                        "https://moderation.example.internal/v1", "m", "k"));
        // Explicit host allowlist makes the same host constructible.
        var policy = com.virtualcompanion.modelruntime.port.ProviderEgressPolicy.defaultsPlus(
                java.util.List.of("moderation.example.internal"));
        new ChatCompletionsSafetyClient(
                "https://moderation.example.internal/v1", "m", "k",
                "ref", "v1", policy,
                com.virtualcompanion.modelruntime.port.EgressDnsGuard.defaults());
    }

    @Test
    void oversizedResponseFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            byte[] resp = ("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\""
                    + "a".repeat(256 * 1024) + "\"}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
        IllegalStateException error = assertThrows(IllegalStateException.class, () ->
                new ChatCompletionsSafetyClient(stubUrl(), "test-model", "k")
                        .classify("x"));
        // The size cap surfaces through the same fail-closed send wrapper.
        assertTrue(error.getMessage().contains("chat-completions call failed"));
    }

    @Test
    void missingChoiceEmptyContentAndMultipleChoicesFailClosed() {
        // No choices / more than one choice.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse("{}"));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        "{\"choices\":[{\"message\":{\"content\":\"{}\"}},"
                                + "{\"message\":{\"content\":\"{}\"}}]}"));
        // Empty / blank content.
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("")));
        assertThrows(IllegalStateException.class,
                () -> ChatCompletionsSafetyClient.parse(
                        completion("   ")));
    }

    private static String completion(String contentJson) {
        return "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
                + "\"" + contentJson.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}}]}";
    }
}
