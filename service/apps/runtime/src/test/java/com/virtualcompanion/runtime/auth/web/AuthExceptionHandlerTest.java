package com.virtualcompanion.runtime.auth.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.UncategorizedSQLException;

/**
 * P1-11: a missing or not-yet-migrated schema must surface as 503
 * SCHEMA_UNAVAILABLE (a service problem), never as a 401 authentication
 * failure. Spring Framework 7 classifies SQLSTATE 42883 / 42P01 / 42703 as
 * {@link BadSqlGrammarException} but 3F000 (invalid schema name, the real
 * empty-database symptom) as {@link UncategorizedSQLException}, so the
 * classification walks the cause/SQLSTATE chain of every DataAccessException.
 * Other persistence failures keep the existing fail-closed
 * AUTHENTICATION_REQUIRED contract.
 */
class AuthExceptionHandlerTest {

    private final AuthExceptionHandler handler = new AuthExceptionHandler();

    @Test
    void undefinedFunctionMapsTo503SchemaUnavailable() {
        assertSchemaUnavailable(new BadSqlGrammarException(
                "task", "SELECT 1", new SQLException("function vc.identity_authenticate(unknown) does not exist", "42883")));
    }

    @Test
    void undefinedTableMapsTo503SchemaUnavailable() {
        assertSchemaUnavailable(new BadSqlGrammarException(
                "task", "SELECT 1", new SQLException("relation \"vc.identity_account\" does not exist", "42P01")));
    }

    @Test
    void undefinedColumnMapsTo503SchemaUnavailable() {
        assertSchemaUnavailable(new BadSqlGrammarException(
                "task", "SELECT 1", new SQLException("column vc.identity_account.id does not exist", "42703")));
    }

    @Test
    void invalidSchemaNameMapsTo503SchemaUnavailable() {
        // The real empty-database symptom: Spring 7 classifies 3F000 as
        // UncategorizedSQLException, not BadSqlGrammarException.
        assertSchemaUnavailable(new UncategorizedSQLException(
                "task", "SELECT out_account_id FROM vc.identity_authenticate(?)",
                new SQLException("schema \"vc\" does not exist", "3F000")));
    }

    @Test
    void schemaStateInNestedCauseChainMapsTo503SchemaUnavailable() {
        assertSchemaUnavailable(new UncategorizedSQLException(
                "task", "SELECT 1",
                new SQLException("root", "08001", new SQLException("schema \"vc\" does not exist", "3F000"))));
    }

    @Test
    void nonSchemaGrammarFailureKeepsExisting401Contract() {
        assertAuthenticationRequired(handler.handleDataAccess(new BadSqlGrammarException(
                "task", "SELECT 1", new SQLException("syntax error at or near \"SELECT\"", "42601"))));
    }

    @Test
    void grammarFailureWithoutSqlStateKeepsExisting401Contract() {
        assertAuthenticationRequired(handler.handleDataAccess(
                new BadSqlGrammarException("task", "SELECT 1", new SQLException("boom"))));
    }

    @Test
    void genericDataAccessFailureKeepsExisting401Contract() {
        assertAuthenticationRequired(handler.handleDataAccess(
                new DataAccessResourceFailureException("connection refused")));
    }

    private static void assertAuthenticationRequired(org.springframework.http.ResponseEntity<ErrorEnvelope> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("AUTHENTICATION_REQUIRED");
    }

    private static void assertSchemaUnavailable(org.springframework.dao.DataAccessException exception) {
        var response = new AuthExceptionHandler().handleDataAccess(exception);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("SCHEMA_UNAVAILABLE");
        assertThat(response.getBody().message()).isNotBlank();
    }
}
