package com.virtualcompanion.runtime.auth.web;

import org.springframework.http.HttpStatus;

/**
 * An auth-flow failure mapped to the uniform {@link ErrorEnvelope} by
 * {@link AuthExceptionHandler}. Every thrown error uses a stable catalog code
 * (AUTHENTICATION_REQUIRED / ACCESS_DENIED / NOT_FOUND_OR_FORBIDDEN) and never
 * carries a password, token or existence hint.
 */
public class AuthErrorException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public AuthErrorException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
