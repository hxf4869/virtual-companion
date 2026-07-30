package com.virtualcompanion.modelopenai.contract;

import java.io.IOException;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;

final class CountingHttpClient extends HttpClient {

    private final HttpClient delegate;
    private final AtomicInteger asynchronousCalls = new AtomicInteger();

    CountingHttpClient() {
        this(HttpClient.newBuilder()
                .followRedirects(Redirect.NEVER)
                .version(Version.HTTP_1_1)
                .build());
    }

    CountingHttpClient(HttpClient delegate) {
        this.delegate = delegate;
    }

    int asynchronousCalls() {
        return asynchronousCalls.get();
    }

    @Override
    public Optional<CookieHandler> cookieHandler() {
        return delegate.cookieHandler();
    }

    @Override
    public Optional<Duration> connectTimeout() {
        return delegate.connectTimeout();
    }

    @Override
    public Redirect followRedirects() {
        return delegate.followRedirects();
    }

    @Override
    public Optional<ProxySelector> proxy() {
        return delegate.proxy();
    }

    @Override
    public SSLContext sslContext() {
        return delegate.sslContext();
    }

    @Override
    public SSLParameters sslParameters() {
        return delegate.sslParameters();
    }

    @Override
    public Optional<Authenticator> authenticator() {
        return delegate.authenticator();
    }

    @Override
    public Version version() {
        return delegate.version();
    }

    @Override
    public Optional<Executor> executor() {
        return delegate.executor();
    }

    @Override
    public <T> HttpResponse<T> send(
            HttpRequest request,
            HttpResponse.BodyHandler<T> responseBodyHandler
    ) throws IOException, InterruptedException {
        return delegate.send(request, responseBodyHandler);
    }

    @Override
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(
            HttpRequest request,
            HttpResponse.BodyHandler<T> responseBodyHandler
    ) {
        asynchronousCalls.incrementAndGet();
        return delegate.sendAsync(request, responseBodyHandler);
    }

    @Override
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(
            HttpRequest request,
            HttpResponse.BodyHandler<T> responseBodyHandler,
            HttpResponse.PushPromiseHandler<T> pushPromiseHandler
    ) {
        asynchronousCalls.incrementAndGet();
        return delegate.sendAsync(request, responseBodyHandler, pushPromiseHandler);
    }
}
