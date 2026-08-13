package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class OwnerBindingSecretBootstrapTest {

    private static final String KEY_32B = "0123456789abcdef0123456789abcdef";

    private static final class StubDb {
        final DataSourceLike dataSource = new DataSourceLike();
        final List<String> insertedKeys = new ArrayList<>();
        String storedKey;
        boolean failInsert;

        final class DataSourceLike {
            Connection connect() throws SQLException {
                Connection connection = mock(Connection.class);
                PreparedStatement insert = mock(PreparedStatement.class);
                PreparedStatement select = mock(PreparedStatement.class);
                when(connection.prepareStatement(OwnerBindingSecretBootstrap.INSERT_SQL))
                        .thenReturn(insert);
                when(connection.prepareStatement(OwnerBindingSecretBootstrap.SELECT_SQL))
                        .thenReturn(select);
                org.mockito.Mockito.doAnswer(invocation -> {
                    insertedKeys.add(invocation.getArgument(1));
                    if (failInsert) {
                        throw new SQLException("simulated insert failure");
                    }
                    if (storedKey == null) {
                        storedKey = insertedKeys.get(0);
                    }
                    return 0;
                }).when(insert).setString(1, KEY_32B);
                ResultSet rows = mock(ResultSet.class);
                when(select.executeQuery()).thenReturn(rows);
                when(rows.next()).thenReturn(storedKey != null);
                when(rows.getString(1)).thenReturn(storedKey);
                return connection;
            }
        }
    }

    private static javax.sql.DataSource dataSourceOf(StubDb db) {
        javax.sql.DataSource dataSource = mock(javax.sql.DataSource.class);
        try {
            // Build the Connection mock BEFORE entering when(): creating mocks
            // inside the stubbing expression leaves the stub unfinished.
            Connection connection = db.dataSource.connect();
            when(dataSource.getConnection()).thenReturn(connection);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        return dataSource;
    }

    @Test
    void rejectsMissingOrTooShortSecret() {
        assertThatThrownBy(() -> new OwnerBindingSecretBootstrap(null, mock(javax.sql.DataSource.class)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OwnerBindingSecretBootstrap("", mock(javax.sql.DataSource.class)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OwnerBindingSecretBootstrap("short", mock(javax.sql.DataSource.class)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void seedsFirstDeploymentAndVerifiesMatchingSecret() {
        StubDb db = new StubDb();
        // First run: the bound INSERT parameter becomes the stored key
        // (ON CONFLICT DO NOTHING then SELECT reads back the same value).
        db.storedKey = KEY_32B;
        new OwnerBindingSecretBootstrap(KEY_32B, dataSourceOf(db)).initializeAndVerify();
        assertThat(db.insertedKeys).containsExactly(KEY_32B);
    }

    @Test
    void verifiesExistingSecretWithoutReseedingIt() {
        StubDb db = new StubDb();
        db.storedKey = KEY_32B;
        new OwnerBindingSecretBootstrap(KEY_32B, dataSourceOf(db)).initializeAndVerify();
        assertThat(db.storedKey).isEqualTo(KEY_32B);
    }

    @Test
    void failsClosedWhenStoredSecretDiffers() {
        StubDb db = new StubDb();
        db.storedKey = "ffffffffffffffffffffffffffffffff";
        assertThatThrownBy(
                        () -> new OwnerBindingSecretBootstrap(KEY_32B, dataSourceOf(db)).initializeAndVerify())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not match")
                .hasMessageNotContaining(KEY_32B);
    }

    @Test
    void failsClosedWhenSecretRowMissing() {
        StubDb db = new StubDb();
        db.storedKey = null;
        assertThatThrownBy(
                        () -> new OwnerBindingSecretBootstrap(KEY_32B, dataSourceOf(db)).initializeAndVerify())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("was not initialized");
    }

    @Test
    void failsClosedOnSqlErrorWithoutLeakingKey() {
        StubDb db = new StubDb();
        db.failInsert = true;
        assertThatThrownBy(
                        () -> new OwnerBindingSecretBootstrap(KEY_32B, dataSourceOf(db)).initializeAndVerify())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(KEY_32B);
    }
}
