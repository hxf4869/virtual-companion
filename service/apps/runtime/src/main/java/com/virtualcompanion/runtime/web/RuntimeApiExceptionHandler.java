package com.virtualcompanion.runtime.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;

/**
 * Maps runtime API (non-auth) request failures to the uniform
 * {@link ErrorEnvelope} (TASK-0178). Coexists with {@code AuthExceptionHandler}
 * (auth-flow failures): this advice owns the resource not-found / bad-request
 * space, while the auth advice owns authentication / authorization / auth
 * persistence failures. Neither advice handles an exception the other owns.
 *
 * <p>Existence is never disclosed: a missing or foreign resource surfaces as
 * 404 {@code NOT_FOUND_OR_FORBIDDEN}; an invalid id or body surfaces as 400
 * {@code INVALID_REQUEST}. Messages are stable and non-sensitive.
 */
@RestControllerAdvice
public class RuntimeApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(RuntimeApiExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorEnvelope> handleNotFound(ResourceNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorEnvelope("NOT_FOUND_OR_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorEnvelope> handleInvalidRequest(IllegalArgumentException e) {
        return invalidRequest();
    }

    /** Bean-validation failure of a {@code @Valid} request body. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorEnvelope> handleValidation(MethodArgumentNotValidException e) {
        return invalidRequest();
    }

    /** Method-validation failure (Spring 6.1+ handler validation). */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ErrorEnvelope> handleHandlerValidation(HandlerMethodValidationException e) {
        return invalidRequest();
    }

    /** Malformed JSON request body. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorEnvelope> handleUnreadableJson(HttpMessageNotReadableException e) {
        return invalidRequest();
    }

    /**
     * TERM-SEM: catch-all for unhandled failures so 5xx responses also carry
     * the uniform {@link ErrorEnvelope} (the OpenAPI contract claims the shape
     * for every error response). The message is stable and non-sensitive; the
     * detail is logged server-side only.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorEnvelope> handleInternal(Exception e) {
        log.error("Unhandled runtime API failure", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorEnvelope("INTERNAL_ERROR", "An internal error occurred"));
    }

    private static ResponseEntity<ErrorEnvelope> invalidRequest() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorEnvelope("INVALID_REQUEST", "The request is invalid"));
    }
}
