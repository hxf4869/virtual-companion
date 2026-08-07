package com.virtualcompanion.runtime.auth.tenant;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Server-side tenant-context mapping (INV-TENANT-001). The authenticated
 * account id IS the owner_user_id -- the mapping is direct and derived solely
 * from the server-verified identity, never from a request field or a
 * development header. {@link #asOwner} runs a unit of work inside one
 * transaction with {@code vc.owner_user_id} bound to that owner, so every
 * FORCE-RLS business query in the work sees exactly the caller's rows and a
 * missing context fails closed.
 *
 * <p>The transaction-scoped binding ({@code set_config(..., true)}) is
 * auto-cleared at commit/rollback, so a leaked connection can never carry an
 * owner context into another request.
 */
public class OwnerContext {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    public OwnerContext(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    /**
     * Run {@code work} within one transaction bound to {@code ownerUserId}.
     * The mapping is direct: user_id == owner_user_id.
     */
    public void asOwner(long ownerUserId, Runnable work) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        transactions.executeWithoutResult(status -> {
            jdbc.update(
                    "SELECT set_config('vc.owner_user_id', ?, true)",
                    ownerSettingValue(ownerUserId));
            work.run();
        });
    }

    /** The GUC value for an owner id: the account id is the owner_user_id. */
    static String ownerSettingValue(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return Long.toString(ownerUserId);
    }
}
