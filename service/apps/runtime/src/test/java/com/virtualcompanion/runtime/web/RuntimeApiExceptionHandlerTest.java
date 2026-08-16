package com.virtualcompanion.runtime.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * TERM-SEM: the catch-all handler keeps 5xx responses on the uniform
 * {@link ErrorEnvelope} shape the OpenAPI contract claims for every error
 * response, with a stable catalog code and a non-sensitive message.
 */
class RuntimeApiExceptionHandlerTest {

    private final RuntimeApiExceptionHandler handler = new RuntimeApiExceptionHandler();

    @Test
    void unhandledExceptionMapsTo500InternalErrorEnvelope() {
        ResponseEntity<ErrorEnvelope> response =
                handler.handleInternal(new IllegalStateException("provider exploded"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("INTERNAL_ERROR");
        assertThat(response.getBody().message()).isEqualTo("An internal error occurred");
    }

    @Test
    void internalErrorMessageNeverLeaksTheCause() {
        ResponseEntity<ErrorEnvelope> response = handler.handleInternal(
                new RuntimeException("secret deployment credential leak simulation"));

        assertThat(response.getBody().message())
                .doesNotContain("secret")
                .doesNotContain("credential");
    }

    @Test
    void invalidRequestShapeIsUnchanged() {
        ResponseEntity<ErrorEnvelope> response =
                handler.handleInvalidRequest(new IllegalArgumentException("bad id"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().code()).isEqualTo("INVALID_REQUEST");
    }

    @Test
    void unmappedRouteStays404InsteadOfFallingIntoTheCatchAll() {
        ResponseEntity<ErrorEnvelope> response =
                handler.handleNoResource(new org.springframework.web.servlet.resource.NoResourceFoundException(
                        org.springframework.http.HttpMethod.GET, "/api/v1/auth/anything", "not found"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody().code()).isEqualTo("NOT_FOUND_OR_FORBIDDEN");
    }

    @Test
    void malformedPathVariableStays400InsteadOfFallingIntoTheCatchAll() {
        ResponseEntity<ErrorEnvelope> response = handler.handleTypeMismatch(
                new org.springframework.web.method.annotation.MethodArgumentTypeMismatchException(
                        "not-a-number",
                        Long.class,
                        "generationId",
                        null,
                        new NumberFormatException("For input string")));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().code()).isEqualTo("INVALID_REQUEST");
    }

    @Test
    void missingSchemaMapsTo503SchemaUnavailable() {
        ResponseEntity<ErrorEnvelope> response = handler.handleSchemaUnavailable(
                new org.springframework.jdbc.BadSqlGrammarException(
                        "task", "SELECT 1", new java.sql.SQLException("schema unavailable", "42P01")));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody().code()).isEqualTo("SCHEMA_UNAVAILABLE");
    }
}
