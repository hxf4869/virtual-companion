package com.virtualcompanion.runtime.auth.web;

/** Fixed, non-sensitive rejection raised by the authentication admission guard. */
public final class AuthRateLimitException extends RuntimeException {

    private final int retryAfterSeconds;

    public AuthRateLimitException(int retryAfterSeconds) {
        super(AuthRateLimitResponse.MESSAGE, null, false, false);
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public int retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
