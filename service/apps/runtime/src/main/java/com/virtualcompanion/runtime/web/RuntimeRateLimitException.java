package com.virtualcompanion.runtime.web;

/** Shared business-route admission rejection with a bounded Retry-After. */
public final class RuntimeRateLimitException extends RuntimeException {

    private final int retryAfterSeconds;

    public RuntimeRateLimitException(int retryAfterSeconds) {
        super("The route is temporarily rate limited");
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public int retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
