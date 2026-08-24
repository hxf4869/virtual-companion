package com.virtualcompanion.runtime.age;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class HttpAgeVerificationAdapterTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void sendsOnlyPseudonymousSubjectAndParsesAdultVerdict() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/verify", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] response = ("{\"state\":\"ADULT_VERIFIED\",\"ageBand\":\"18_PLUS\","
                    + "\"providerVersion\":\"revision-1\"}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        var result = adapter("/verify").verify(123456789L);

        assertEquals(AgeState.ADULT_VERIFIED, result.state());
        assertEquals("vendor-a@revision-1", result.providerRef());
        assertEquals("Bearer test-key", authorization.get());
        assertTrue(requestBody.get().matches(
                "\\{\"subject\":\"age_[0-9a-f]{64}\"\\}"), requestBody.get());
        assertFalse(requestBody.get().contains("123456789"));
        assertFalse(requestBody.get().contains("document"));
        assertFalse(requestBody.get().contains("biometric"));
    }

    @Test
    void strictResponseValidationFailsClosed() {
        assertThrows(IllegalStateException.class, () -> HttpAgeVerificationAdapter.parse(
                "{\"state\":\"ADULT_VERIFIED\",\"ageBand\":\"18_PLUS\","
                        + "\"providerVersion\":\"revision-1\",\"document\":\"x\"}",
                "revision-1"));
        assertThrows(IllegalStateException.class, () -> HttpAgeVerificationAdapter.parse(
                "{\"state\":\"ADULT_VERIFIED\",\"ageBand\":\"UNDER_18\","
                        + "\"providerVersion\":\"revision-1\"}",
                "revision-1"));
        assertThrows(IllegalStateException.class, () -> HttpAgeVerificationAdapter.parse(
                "{\"state\":\"AGE_UNKNOWN\",\"ageBand\":\"UNKNOWN\","
                        + "\"providerVersion\":\"revision-1\"}",
                "revision-1"));
        assertThrows(IllegalStateException.class, () -> HttpAgeVerificationAdapter.parse(
                "{\"state\":\"MINOR_VERIFIED\",\"ageBand\":\"UNDER_18\","
                        + "\"providerVersion\":\"different\"}",
                "revision-1"));
    }

    @Test
    void providerFailureFailsClosed() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/verify", exchange -> {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();

        assertThrows(IllegalStateException.class, () -> adapter("/verify").verify(1L));
    }

    private HttpAgeVerificationAdapter adapter(String path) {
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + path;
        return new HttpAgeVerificationAdapter(
                endpoint,
                "test-key",
                "vendor-a",
                "revision-1",
                "0123456789abcdef0123456789abcdef",
                ProviderEgressPolicy.defaults(),
                EgressDnsGuard.defaults());
    }
}
