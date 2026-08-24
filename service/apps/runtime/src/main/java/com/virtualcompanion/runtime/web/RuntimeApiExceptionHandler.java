package com.virtualcompanion.runtime.web;

import com.virtualcompanion.runtime.servicemode.ServiceWindowClosedException;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

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
 *
 * <p>TERM-SEM: framework-level failures that the catch-all would otherwise
 * swallow keep their semantics -- an unmapped route stays 404, a malformed
 * path variable stays 400, and a missing/not-yet-migrated schema stays 503
 * {@code SCHEMA_UNAVAILABLE} (same mapping as the auth advice's P1-11 rule).
 * Everything else falls through to a uniform 500 {@code INTERNAL_ERROR}.
 */
@RestControllerAdvice
public class RuntimeApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(RuntimeApiExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorEnvelope> handleNotFound(ResourceNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorEnvelope("NOT_FOUND_OR_FORBIDDEN", e.getMessage()));
    }

    /** An unmapped route is a 404, never a 500 (TERM-SEM catch-all guard). */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorEnvelope> handleNoResource(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorEnvelope("NOT_FOUND_OR_FORBIDDEN",
                        "The requested resource does not exist"));
    }

    /**
     * SVC-WINDOW (§24.7 / FR-RES-002): a new generative turn is refused by
     * the Beta service window. 403 BETA_OPERATIONS_NOT_READY — the plain
     * message states the window; history/memory/data rights stay available.
     */
    @ExceptionHandler(ServiceWindowClosedException.class)
    public ResponseEntity<ErrorEnvelope> handleServiceWindowClosed(ServiceWindowClosedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ErrorEnvelope("BETA_OPERATIONS_NOT_READY", e.getMessage()));
    }

    /**
     * S0-04: generation admission denied. Adult failures use the catalog
     * AGE_VERIFICATION_REQUIRED code; every other gate uses
     * BETA_OPERATIONS_NOT_READY. History/memory/data rights stay available.
     */
    @ExceptionHandler(com.virtualcompanion.runtime.admission.AdmissionDeniedException.class)
    public ResponseEntity<ErrorEnvelope> handleAdmissionDenied(
            com.virtualcompanion.runtime.admission.AdmissionDeniedException e) {
        String code = "adult-verification-required".equals(e.reason())
                ? "AGE_VERIFICATION_REQUIRED"
                : "BETA_OPERATIONS_NOT_READY";
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ErrorEnvelope(code, e.getMessage()));
    }

    /**
     * EMERGENCY-CONTACT (§20.14): the capability is disabled on this
     * deployment (enablement requires the §20.14 review). 403
     * BETA_OPERATIONS_NOT_READY, fail closed on every endpoint.
     */
    @ExceptionHandler(EmergencyContactDisabledException.class)
    public ResponseEntity<ErrorEnvelope> handleEmergencyContactDisabled(
            EmergencyContactDisabledException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ErrorEnvelope("BETA_OPERATIONS_NOT_READY", e.getMessage()));
    }

    @ExceptionHandler(RuntimeRateLimitException.class)
    public void handleRuntimeRateLimit(
            RuntimeRateLimitException e, HttpServletResponse response) throws IOException {
        // Write directly so a 429 raised before an SSE stream opens is not forced
        // through that handler's text/event-stream content negotiation.
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(
                org.springframework.http.HttpHeaders.RETRY_AFTER,
                Integer.toString(e.retryAfterSeconds()));
        response.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
        response.setContentType(org.springframework.http.MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"code\":\"RATE_LIMITED\",\"message\":"
                        + "\"The route is temporarily rate limited\"}");
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

    /** A malformed path variable / query parameter is a 400, never a 500. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorEnvelope> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return invalidRequest();
    }

    /** A missing required query parameter is a 400, never a 500. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorEnvelope> handleMissingParameter(MissingServletRequestParameterException e) {
        return invalidRequest();
    }

    /**
     * A missing or not-yet-migrated schema is a service problem, not an
     * internal error: 503 SCHEMA_UNAVAILABLE (the same mapping as the auth
     * advice's P1-11 rule). Realtime resume deliberately re-throws this type
     * so it lands here instead of being masked as a stream denial.
     */
    @ExceptionHandler(BadSqlGrammarException.class)
    public ResponseEntity<ErrorEnvelope> handleSchemaUnavailable(BadSqlGrammarException e) {
        log.error("Schema unavailable (SQLSTATE {}): {}", sqlStateOf(e), e.getMessage());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ErrorEnvelope("SCHEMA_UNAVAILABLE",
                        "The service schema is not available; verify migrations are applied"));
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

    private static String sqlStateOf(Throwable e) {
        for (Throwable current = e; current != null; current = current.getCause()) {
            if (current instanceof java.sql.SQLException sqlException) {
                return String.valueOf(sqlException.getSQLState());
            }
        }
        return "unknown";
    }

    private static ResponseEntity<ErrorEnvelope> invalidRequest() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorEnvelope("INVALID_REQUEST", "The request is invalid"));
    }
}
