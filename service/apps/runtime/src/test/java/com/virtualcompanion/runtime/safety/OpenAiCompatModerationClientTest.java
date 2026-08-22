package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
                    + "{\"violence\":true,\"hate\":false}}]}").getBytes();
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
    }

    @Test
    void cleanResultIsNotFlaggedAndHttpErrorFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/moderations", exchange -> {
            byte[] resp = "{\"results\":[{\"flagged\":false,\"categories\":{}}]}"
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
    void missingResultsFailsClosedInsteadOfClean() {
        assertThrows(IllegalStateException.class,
                () -> OpenAiCompatModerationClient.parse("{}"));
        assertThrows(IllegalStateException.class,
                () -> OpenAiCompatModerationClient.parse("{\"results\":[]}"));
    }
}
