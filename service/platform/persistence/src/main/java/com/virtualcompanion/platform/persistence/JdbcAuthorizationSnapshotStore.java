package com.virtualcompanion.platform.persistence;

import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderId;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * JDBC skeleton for {@link AuthorizationSnapshotStore}.
 *
 * <p>Snapshots are tenant scoped. The table is protected by FORCE ROW LEVEL
 * SECURITY and the owner is never a constructor argument of the value object:
 * {@code owner_user_id} is bound to the active tenant context
 * ({@code vc.current_owner_id()}) at insert time, so a snapshot is always
 * persisted under the owner established by the surrounding request. Reads are
 * restricted by RLS to that same owner; with no context bound, reads return
 * empty and writes fail — fail-closed tenant isolation (INV-TENANT-001,
 * INV-AUTH-001).
 *
 * <p>This is the persistence skeleton: the schema, roles and policies live in
 * the Flyway migrations, and this class wires the domain port to that substrate.
 */
public class JdbcAuthorizationSnapshotStore implements AuthorizationSnapshotStore {

    private final JdbcTemplate jdbc;

    public JdbcAuthorizationSnapshotStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String UPSERT_SQL = """
            INSERT INTO vc.authorization_snapshot
                (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
                 purpose, data_categories, task_cancelled, source_data_deleted)
            VALUES (vc.current_owner_id(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (owner_user_id, snapshot_id) DO UPDATE SET
                status = EXCLUDED.status,
                provider_id = EXCLUDED.provider_id,
                region = EXCLUDED.region,
                contract_ref = EXCLUDED.contract_ref,
                purpose = EXCLUDED.purpose,
                data_categories = EXCLUDED.data_categories,
                task_cancelled = EXCLUDED.task_cancelled,
                source_data_deleted = EXCLUDED.source_data_deleted
            """;

    private static final String SELECT_BY_ID_SQL = """
            SELECT owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
                   purpose, data_categories, task_cancelled, source_data_deleted
            FROM vc.authorization_snapshot
            WHERE snapshot_id = ?
            """;

    @Override
    public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
        String[] categories = encodeCategories(snapshot.dataCategories());
        jdbc.update(UPSERT_SQL, ps -> {
            int i = 1;
            ps.setString(i++, snapshot.id().value());
            ps.setString(i++, snapshot.status().name());
            ps.setString(i++, snapshot.providerId().value());
            ps.setString(i++, snapshot.region().value());
            ps.setString(i++, snapshot.contractRef().value());
            ps.setString(i++, snapshot.purpose().name());
            ps.setArray(i++, ps.getConnection().createArrayOf("text", categories));
            ps.setBoolean(i++, snapshot.taskCancelled());
            ps.setBoolean(i, snapshot.sourceDataDeleted());
        });
        return snapshot;
    }

    @Override
    public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
        return jdbc.query(SELECT_BY_ID_SQL, rowMapper(), id.value()).stream().findFirst();
    }

    @Override
    public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
        int affected = jdbc.update(
                "UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN' WHERE snapshot_id = ?",
                id.value());
        if (affected == 0) {
            throw new IllegalStateException("authorization snapshot not found: " + id.value());
        }
        return find(id).orElseThrow();
    }

    @Override
    public AuthorizationSnapshot narrow(AuthorizationSnapshotId id, AuthorizationSnapshot narrowed) {
        String[] categories = encodeCategories(narrowed.dataCategories());
        int affected = jdbc.update("""
                UPDATE vc.authorization_snapshot SET
                    status = 'NARROWED',
                    provider_id = ?, region = ?, contract_ref = ?, purpose = ?,
                    data_categories = ?, task_cancelled = ?, source_data_deleted = ?
                WHERE snapshot_id = ?
                """, ps -> {
            int i = 1;
            ps.setString(i++, narrowed.providerId().value());
            ps.setString(i++, narrowed.region().value());
            ps.setString(i++, narrowed.contractRef().value());
            ps.setString(i++, narrowed.purpose().name());
            ps.setArray(i++, ps.getConnection().createArrayOf("text", categories));
            ps.setBoolean(i++, narrowed.taskCancelled());
            ps.setBoolean(i++, narrowed.sourceDataDeleted());
            ps.setString(i, id.value());
        });
        if (affected == 0) {
            throw new IllegalStateException("authorization snapshot not found: " + id.value());
        }
        return find(id).orElseThrow();
    }

    private RowMapper<AuthorizationSnapshot> rowMapper() {
        return (ResultSet rs, int rowNum) -> new AuthorizationSnapshot(
                new AuthorizationSnapshotId(rs.getString("snapshot_id")),
                AuthorizationStatus.valueOf(rs.getString("status")),
                new ProviderId(rs.getString("provider_id")),
                new ProviderRegion(rs.getString("region")),
                new ProviderContractRef(rs.getString("contract_ref")),
                ProcessingPurpose.valueOf(rs.getString("purpose")),
                decodeCategories(rs.getArray("data_categories")),
                rs.getBoolean("task_cancelled"),
                rs.getBoolean("source_data_deleted"));
    }

    static String[] encodeCategories(Set<DataCategory> categories) {
        return categories.stream().map(DataCategory::name).toArray(String[]::new);
    }

    static Set<DataCategory> decodeCategoryNames(String[] names) {
        Set<DataCategory> result = new LinkedHashSet<>();
        for (String name : names) {
            result.add(DataCategory.valueOf(name));
        }
        return result;
    }

    static Set<DataCategory> decodeCategories(Array array) throws SQLException {
        return decodeCategoryNames((String[]) array.getArray());
    }
}
