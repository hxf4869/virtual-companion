package com.virtualcompanion.platform.persistence;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * JDBC skeleton repository for {@link ProviderDeploymentRecord}.
 *
 * <p>Provider deployments are platform reference data (not tenant scoped): the
 * {@code provider_deployment} table carries no {@code owner_user_id} and no RLS,
 * so every runtime role reads the same admitted deployments. Admission
 * transitions are written by the coordinator role. This repository is the
 * durable admission source the runtime {@code ProviderRegistry} overlays onto
 * locally wired adapters; it does not own adapter lifecycle.
 */
public class JdbcProviderDeploymentRepository {

    private final JdbcTemplate jdbc;

    public JdbcProviderDeploymentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String UPSERT_SQL = """
            INSERT INTO vc.provider_deployment
                (provider_id, protocol, capabilities, admission_state)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (provider_id) DO UPDATE SET
                protocol = EXCLUDED.protocol,
                capabilities = EXCLUDED.capabilities,
                admission_state = EXCLUDED.admission_state,
                updated_at = now()
            """;

    private static final String SELECT_BASE = """
            SELECT provider_id, protocol, capabilities, admission_state
            FROM vc.provider_deployment
            """;

    public void save(ProviderDeploymentRecord record) {
        String[] capabilities = record.capabilities().toArray(String[]::new);
        jdbc.update(UPSERT_SQL, ps -> {
            ps.setString(1, record.providerId());
            ps.setString(2, record.protocol());
            ps.setArray(3, ps.getConnection().createArrayOf("text", capabilities));
            ps.setString(4, record.admissionState());
        });
    }

    public Optional<ProviderDeploymentRecord> findByProviderId(String providerId) {
        return jdbc.query(
                SELECT_BASE + " WHERE provider_id = ?",
                rowMapper(),
                providerId).stream().findFirst();
    }

    public List<ProviderDeploymentRecord> findAdmitted() {
        return jdbc.query(
                SELECT_BASE + " WHERE admission_state = 'ADMITTED' ORDER BY provider_id",
                rowMapper());
    }

    public List<ProviderDeploymentRecord> findAll() {
        return jdbc.query(SELECT_BASE + " ORDER BY provider_id", rowMapper());
    }

    private RowMapper<ProviderDeploymentRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new ProviderDeploymentRecord(
                rs.getString("provider_id"),
                rs.getString("protocol"),
                decodeCapabilities(rs.getArray("capabilities")),
                rs.getString("admission_state"));
    }

    private static List<String> decodeCapabilities(Array array) throws SQLException {
        String[] names = (String[]) array.getArray();
        List<String> result = new ArrayList<>(names.length);
        for (String name : names) {
            result.add(name);
        }
        return List.copyOf(result);
    }
}
