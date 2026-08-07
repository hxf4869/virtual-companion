package com.virtualcompanion.modelanthropic.contract;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

final class MockAnthropicServer implements AutoCloseable {

    private final HttpServer server;
    private final ExecutorService executor;
    private final BlockingQueue<CapturedRequest> requests = new LinkedBlockingQueue<>();
    private final AtomicInteger requestCount = new AtomicInteger();

    MockAnthropicServer(Responder responder) throws IOException {
        var loopback = InetAddress.getByAddress(new byte[]{127, 0, 0, 1});
        server = HttpServer.create(new InetSocketAddress(loopback, 0), 0);
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/v1/messages", exchange -> {
            requestCount.incrementAndGet();
            requests.add(capture(exchange));
            try (exchange) {
                responder.respond(exchange);
            }
        });
        server.start();
    }

    URI endpoint() {
        var address = server.getAddress();
        if (!address.getAddress().isLoopbackAddress()) {
            throw new IllegalStateException("mock server must be loopback-only");
        }
        return URI.create(
                "http://127.0.0.1:"
                        + address.getPort()
                        + "/v1/messages"
        );
    }

    int requestCount() {
        return requestCount.get();
    }

    CapturedRequest awaitRequest() throws InterruptedException {
        var request = requests.poll(5, TimeUnit.SECONDS);
        if (request == null) {
            throw new AssertionError("mock server did not receive a request");
        }
        return request;
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
    }

    static Responder fixed(int status, String contentType, String body) {
        return exchange -> {
            var bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
        };
    }

    static void beginChunked(HttpExchange exchange, String contentType)
            throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(200, 0);
    }

    static void writeAndFlush(HttpExchange exchange, String value)
            throws IOException {
        exchange.getResponseBody().write(value.getBytes(StandardCharsets.UTF_8));
        exchange.getResponseBody().flush();
    }

    private static CapturedRequest capture(HttpExchange exchange)
            throws IOException {
        var headers = exchange.getRequestHeaders().entrySet().stream()
                .collect(Collectors.toUnmodifiableMap(
                        entry -> entry.getKey().toLowerCase(Locale.ROOT),
                        entry -> List.copyOf(entry.getValue())
                ));
        return new CapturedRequest(
                exchange.getRequestMethod(),
                exchange.getRequestURI(),
                headers,
                new String(
                        exchange.getRequestBody().readAllBytes(),
                        StandardCharsets.UTF_8
                ),
                exchange.getLocalAddress().getAddress().isLoopbackAddress()
        );
    }

    @FunctionalInterface
    interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }

    record CapturedRequest(
            String method,
            URI uri,
            Map<String, List<String>> headers,
            String body,
            boolean loopback
    ) {
        String firstHeader(String name) {
            var values = headers.get(name.toLowerCase(Locale.ROOT));
            return values == null || values.isEmpty() ? null : values.getFirst();
        }
    }
}
