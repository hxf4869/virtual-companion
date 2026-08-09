package com.virtualcompanion.runtime.auth.web;

import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps identity-flow failures to the uniform {@link ErrorEnvelope} with a
 * stable catalog code and a non-sensitive message. Existence is never
 * disclosed: an unknown user, a wrong password and a duplicate account all
 * surface as NOT_FOUND_OR_FORBIDDEN; invalid/expired/disabled sessions surface
 * as AUTHENTICATION_REQUIRED; a non-ADMIN caller surfaces as ACCESS_DENIED.
 * Authentication-time persistence failures also fail closed to
 * AUTHENTICATION_REQUIRED (never an internal-error detail).
 */
@RestControllerAdvice
public class AuthExceptionHandler {

    @ExceptionHandler(AuthRateLimitException.class)
    public ResponseEntity<ErrorEnvelope> handleRateLimit(AuthRateLimitException e) {
        return AuthRateLimitResponse.entity(e.retryAfterSeconds());
    }

    @ExceptionHandler(AuthErrorException.class)
    public ResponseEntity<ErrorEnvelope> handleAuthError(AuthErrorException e) {
        return ResponseEntity.status(e.status())
                .body(new ErrorEnvelope(e.code(), e.getMessage()));
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorEnvelope> handleBadCredentials(BadCredentialsException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ErrorEnvelope("AUTHENTICATION_REQUIRED",
                        "A valid authentication context is required"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorEnvelope> handleAccessDenied(AccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ErrorEnvelope("ACCESS_DENIED", "The caller lacks the required role"));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ErrorEnvelope> handleDataAccess(DataAccessException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ErrorEnvelope("AUTHENTICATION_REQUIRED",
                        "A valid authentication context is required"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorEnvelope> handleValidation(MethodArgumentNotValidException e) {
        return invalidRequest();
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorEnvelope> handleUnreadableJson(HttpMessageNotReadableException e) {
        return invalidRequest();
    }

    private static ResponseEntity<ErrorEnvelope> invalidRequest() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorEnvelope("INVALID_REQUEST", "The request is invalid"));
    }
}
