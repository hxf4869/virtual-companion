package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** R49 MODERATION: wire-level test against a local stub server. */
class OpenAiCompatModerationClientTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void parsesFlaggedResultWithCategories() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/moderations", exchange -> {
            byte[] resp = ("{\"results\":[{\"flagged\":true,\"categories\":"
                    + "{\"violence\":true,\"hate\":false},\"category_scores\":"
                    + "{\"violence\":0.97,\"hate\":0.01}}]}").getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";

        var result = new OpenAiCompatModerationClient(url, "omni-moderation-latest", "k")
                .moderate("some text");

        assertTrue(result.flagged());
        assertEquals(List.of("violence"), result.categories());
        assertEquals(0.97, result.confidence(), 0.0001);
    }

    @Test
    void cleanResultIsNotFlaggedAndHttpErrorFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/moderations", exchange -> {
            byte[] resp = ("{\"results\":[{\"flagged\":false,\"categories\":"
                    + "{\"violence\":false},\"category_scores\":{\"violence\":0.05}}]}")
                    .getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";

        var client = new OpenAiCompatModerationClient(url, "m", "k");
        assertFalse(client.moderate("fine").flagged());

        // Port 1 refuses connections: delivery failure must fail closed.
        assertThrows(IllegalStateException.class, () -> new OpenAiCompatModerationClient(
                "http://127.0.0.1:1/v1", "m", "k").moderate("x"));
    }

    @Test
    void lowConfidenceCleanResultFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/moderations", exchange -> {
            byte[] resp = ("{\"results\":[{\"flagged\":false,\"categories\":"
                    + "{\"violence\":false},\"category_scores\":{\"violence\":0.30}}]}")
                    .getBytes();
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";

        assertThrows(IllegalStateException.class, () ->
                new OpenAiCompatModerationClient(
                        url, "m", "k", "provider-test", "revision-1", 0.8)
                        .moderate("ambiguous"));
    }

    @Test
    void missingResultsFailsClosedInsteadOfClean() {
        assertThrows(IllegalStateException.class,
                () -> OpenAiCompatModerationClient.parse("{}"));
        assertThrows(IllegalStateException.class,
                () -> OpenAiCompatModerationClient.parse("{\"results\":[]}"));
        assertThrows(IllegalStateException.class, () -> OpenAiCompatModerationClient.parse(
                "{\"results\":[{\"flagged\":false,\"categories\":{\"violence\":false}}]}"));
        assertThrows(IllegalStateException.class, () -> OpenAiCompatModerationClient.parse(
                "{\"results\":[{\"flagged\":false,\"categories\":{\"violence\":true},"
                        + "\"category_scores\":{\"violence\":0.9}}]}"));
        assertThrows(IllegalStateException.class, () -> OpenAiCompatModerationClient.parse(
                "{\"results\":[{\"flagged\":\"false\",\"categories\":{\"violence\":false},"
                        + "\"category_scores\":{\"violence\":0.1}}]}"));
    }
}
