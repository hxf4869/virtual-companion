package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * R49 flexible-provider embedder: speaks OpenAI-compatible /embeddings against
 * any configured base URL; auth header and request shape are asserted on the
 * wire via a local stub server.
 */
class OpenAiCompatEmbedderTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void postsBearerAuthAndParsesVector() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var captured = new StringBuilder();
        server.createContext("/v1/embeddings", exchange -> {
            captured.append("AUTH:").append(exchange.getRequestHeaders()
                    .getFirst("Authorization")).append("\n");
            captured.append(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            byte[] resp = "{\"data\":[{\"embedding\":[0.5,-1.25,2.0]}]}".getBytes();
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";

        float[] v = new OpenAiCompatEmbedder(url, "text-embedding-3-small", "sk-test")
                .embed("hello");

        assertArrayEquals(new float[]{0.5f, -1.25f, 2.0f}, v);
        assertEquals("AUTH:Bearer sk-test", captured.toString().split("\n")[0]);
        org.junit.jupiter.api.Assertions.assertTrue(
                captured.toString().contains("\"model\":\"text-embedding-3-small\""));
    }

    @Test
    void httpErrorFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> exchange.sendResponseHeaders(500, -1));
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";

        assertThrows(IllegalStateException.class,
                () -> new OpenAiCompatEmbedder(url, "m", "k").embed("x"));
    }
}
