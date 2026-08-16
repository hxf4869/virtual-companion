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
}
