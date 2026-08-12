package com.virtualcompanion.platform.persistence;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.registry.ProviderDeployment;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.sql.ResultSet;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

/**
 * JDBC {@link AuthorizationSnapshotProvider} (TASK-0181).
 *
 * <p>Mints the dual requested + execution authorization snapshots for one
 * generation's external attempt through the V26 SECURITY DEFINER function
 * {@code vc.create_authorization_snapshots} (the only runtime write path after
 * V16 revoked direct INSERT/UPDATE/DELETE from every runtime role), then mirrors
 * the two {@link AuthorizationSnapshot} values into the in-memory store the
 * {@code ExecutionAuthorizationGuard} reads before the invoker opens a session.
 *
 * <p>The snapshot provider id is derived from the runtime
 * {@link ProviderRegistry} with exactly the {@code DeterministicRouter}
 * candidate rule (admitted deployments of the configured external protocol,
 * ordered by provider id, first wins) so the execution snapshot's provider
 * always equals the deployment the router selects at invocation time; a
 * registry with no admitted deployment fails closed before any snapshot row
 * exists. region / contract / purpose / data categories are the configured
 * authorization intent of the attempt (runtime configuration, never guessed).
 *
 * <p>Runs inside the worker's owner-bound transaction, so the V26 call
 * executes in the correct server-trusted tenant context (V17 assertion
 * re-validates {@code p_owner_user_id}); a schema-missing
 * {@code BadSqlGrammarException} or a business RAISE propagates to the worker
 * handler, which terminalizes the generation fail-closed (no HTTP mapping
 * exists on this path).
 */
public class JdbcAuthorizationSnapshotProvider implements AuthorizationSnapshotProvider {

    private static final String CREATE_SNAPSHOTS_SQL = """
            SELECT out_requested_id, out_execution_id
              FROM vc.create_authorization_snapshots(?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate jdbc;
    private final AuthorizationSnapshotStore mirrorStore;
    private final ProviderRegistry registry;
    private final ModelProtocol externalProtocol;
    private final ProviderRegion region;
    private final ProviderContractRef contractRef;
    private final ProcessingPurpose purpose;
    private final Set<DataCategory> dataCategories;

    public JdbcAuthorizationSnapshotProvider(
            JdbcTemplate jdbc,
            AuthorizationSnapshotStore mirrorStore,
            ProviderRegistry registry,
            ModelProtocol externalProtocol,
            ProviderRegion region,
            ProviderContractRef contractRef,
            ProcessingPurpose purpose,
            Set<DataCategory> dataCategories) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.mirrorStore = Objects.requireNonNull(mirrorStore, "mirrorStore must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.externalProtocol = Objects.requireNonNull(
                externalProtocol, "externalProtocol must not be null");
        this.region = Objects.requireNonNull(region, "region must not be null");
        this.contractRef = Objects.requireNonNull(contractRef, "contractRef must not be null");
        this.purpose = Objects.requireNonNull(purpose, "purpose must not be null");
        this.dataCategories = Set.copyOf(Objects.requireNonNull(
                dataCategories, "dataCategories must not be null"));
        if (this.dataCategories.isEmpty()) {
            throw new IllegalArgumentException("dataCategories must not be empty");
        }
    }

    @Override
    public SnapshotIds createFor(long ownerUserId, long generationId) {
        validateIds(ownerUserId, generationId);
        ProviderId providerId = selectProviderId();

        String[] categories = dataCategories.stream()
                .map(DataCategory::name)
                .toArray(String[]::new);
        List<CreatedSnapshotIds> rows = jdbc.query(CREATE_SNAPSHOTS_SQL, ps -> {
            int i = 1;
            ps.setLong(i++, ownerUserId);
            ps.setLong(i++, generationId);
            ps.setString(i++, providerId.value());
            ps.setString(i++, region.value());
            ps.setString(i++, contractRef.value());
            ps.setString(i++, purpose.name());
            ps.setArray(i, ps.getConnection().createArrayOf("text", categories));
        }, CREATED_IDS_ROW_MAPPER);
        if (rows.size() != 1) {
            throw new IllegalStateException(
                    "create_authorization_snapshots returned " + rows.size()
                            + " rows for owner " + ownerUserId + " generation " + generationId);
        }

        CreatedSnapshotIds created = rows.getFirst();
        AuthorizationSnapshot requested = snapshot(providerId, created.requestedId());
        AuthorizationSnapshot execution = snapshot(providerId, created.executionId());
        // Mirror both snapshots into the store the ExecutionAuthorizationGuard
        // reads; a store failure fails closed before any outbound transfer.
        mirrorStore.put(requested);
        mirrorStore.put(execution);
        return new SnapshotIds(created.requestedId(), created.executionId());
    }

    private ProviderId selectProviderId() {
        return registry.deployments().stream()
                .filter(ProviderDeployment::isAdmitted)
                .filter(deployment -> deployment.protocol() == externalProtocol)
                .sorted(Comparator.comparing(deployment -> deployment.providerId().value()))
                .map(ProviderDeployment::providerId)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "no admitted provider deployment matches protocol " + externalProtocol
                                + "; cannot mint authorization snapshots"));
    }

    private AuthorizationSnapshot snapshot(ProviderId providerId, String snapshotId) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(snapshotId),
                AuthorizationStatus.ACTIVE,
                providerId,
                region,
                contractRef,
                purpose,
                dataCategories,
                false,
                false);
    }

    private static void validateIds(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
    }

    record CreatedSnapshotIds(String requestedId, String executionId) {
    }

    static final RowMapper<CreatedSnapshotIds> CREATED_IDS_ROW_MAPPER =
            (ResultSet rs, int rowNum) -> new CreatedSnapshotIds(
                    rs.getString("out_requested_id"),
                    rs.getString("out_execution_id"));
}
