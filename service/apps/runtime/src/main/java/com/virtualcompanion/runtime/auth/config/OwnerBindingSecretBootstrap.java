package com.virtualcompanion.runtime.auth.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

/**
 * TASK-0191 migrator-side initialization of the V27 owner-binding secret.
 *
 * <p>The key material for the owner-context HMAC binding is deliberately NOT
 * expanded into versioned Flyway SQL. Instead, right after Flyway applies the
 * migrations (still on the migrator principal, before business traffic and
 * before readiness goes green), this component performs an idempotent
 * parameter-bound initialization:
 *
 * <ol>
 *   <li>INSERT ... ON CONFLICT DO NOTHING with the process key as a bound
 *       parameter (first deployment seeds the table);</li>
 *   <li>read the stored key back and compare it in constant time -- a
 *       deployment whose {@code VC_OWNER_BINDING_SECRET} disagrees with the
 *       database fails startup instead of silently binding contexts that the
 *       database would reject.</li>
 * </ol>
 *
 * <p>The key is at least 32 bytes, is an independent random value (never
 * derived from the DB password), and is never logged, never embedded in
 * exception messages and never written into the repository.
 */
public class OwnerBindingSecretBootstrap {

    static final String INSERT_SQL =
            "INSERT INTO vc._owner_binding_secret(id, secret) VALUES (1, ?) "
                    + "ON CONFLICT (id) DO NOTHING";
    static final String SELECT_SQL =
            "SELECT secret FROM vc._owner_binding_secret WHERE id = 1";

    private final String ownerBindingSecret;
    private final DataSource migratorDataSource;

    public OwnerBindingSecretBootstrap(String ownerBindingSecret, DataSource migratorDataSource) {
        if (ownerBindingSecret == null || ownerBindingSecret.isBlank()) {
            throw new IllegalStateException(
                    "VC_OWNER_BINDING_SECRET is required when Flyway runs the V27 migration");
        }
        if (ownerBindingSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "VC_OWNER_BINDING_SECRET must carry at least 32 bytes of key material");
        }
        if (migratorDataSource == null) {
            throw new IllegalStateException("migrator DataSource is required");
        }
        this.ownerBindingSecret = ownerBindingSecret;
        this.migratorDataSource = migratorDataSource;
    }

    /** Validate, seed (first run) and verify the stored binding secret. */
    public void initializeAndVerify() {
        byte[] expected = ownerBindingSecret.getBytes(StandardCharsets.US_ASCII);
        try (Connection connection = migratorDataSource.getConnection()) {
            try (PreparedStatement insert = connection.prepareStatement(INSERT_SQL)) {
                insert.setString(1, ownerBindingSecret);
                insert.executeUpdate();
            }
            String stored;
            try (PreparedStatement select = connection.prepareStatement(SELECT_SQL)) {
                try (ResultSet rows = select.executeQuery()) {
                    if (!rows.next()) {
                        throw new IllegalStateException(
                                "owner binding secret was not initialized");
                    }
                    stored = rows.getString(1);
                }
            }
            if (stored == null
                    || !MessageDigest.isEqual(
                            expected, stored.getBytes(StandardCharsets.US_ASCII))) {
                throw new IllegalStateException(
                        "VC_OWNER_BINDING_SECRET does not match the stored owner binding secret");
            }
        } catch (SQLException e) {
            // Never include the key or any bound parameter value here.
            throw new IllegalStateException(
                    "owner binding secret bootstrap failed: " + e.getClass().getSimpleName(), e);
        }
    }
}
