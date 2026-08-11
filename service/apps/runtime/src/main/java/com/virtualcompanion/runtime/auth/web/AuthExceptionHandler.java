package com.virtualcompanion.runtime.auth.web;

import java.sql.SQLException;
import java.util.Set;
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
 *
 * <p>P1-11: a missing or not-yet-migrated schema must not masquerade as an
 * authentication failure. Any DataAccessException whose SQLSTATE chain shows
 * undefined functions, tables, columns or a missing schema (PostgreSQL
 * SQLSTATE 42883 / 42P01 / 42703 / 3F000) maps to 503 SCHEMA_UNAVAILABLE
 * instead of the generic 401 path; every other persistence failure keeps the
 * existing fail-closed AUTHENTICATION_REQUIRED contract.
 */
@RestControllerAdvice
public class AuthExceptionHandler {

    /** PostgreSQL SQLSTATEs that mean the schema (or a piece of it) is missing. */
    private static final Set<String> SCHEMA_UNAVAILABLE_SQL_STATES =
            Set.of("42883", "42P01", "42703", "3F000");

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

    /**
     * P1-11: missing-schema SQL failures are a service problem, not an
     * authentication problem. Spring Framework 7 classifies SQLSTATE 3F000
     * (invalid schema name) as a plain {@code UncategorizedSQLException} and
     * the 42xxx family as {@link BadSqlGrammarException}, so classification
     * walks the cause/SQLSTATE chain of every DataAccessException; other
     * persistence failures keep the existing fail-closed AUTHENTICATION_REQUIRED
     * contract.
     */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ErrorEnvelope> handleDataAccess(DataAccessException e) {
        if (isSchemaUnavailable(e)) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(new ErrorEnvelope("SCHEMA_UNAVAILABLE",
                            "The service schema is not available; verify migrations are applied"));
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ErrorEnvelope("AUTHENTICATION_REQUIRED",
                        "A valid authentication context is required"));
    }

    private static boolean isSchemaUnavailable(DataAccessException e) {
        for (Throwable current = e; current != null; current = current.getCause()) {
            if (current instanceof SQLException sqlException) {
                for (SQLException cause = sqlException;
                        cause != null;
                        cause = cause.getNextException()) {
                    String sqlState = cause.getSQLState();
                    if (sqlState != null && SCHEMA_UNAVAILABLE_SQL_STATES.contains(sqlState)) {
                        return true;
                    }
                }
            }
        }
        return false;
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
