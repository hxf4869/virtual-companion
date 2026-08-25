package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;

/**
 * Commits the durable delete intent before signalling process-local providers.
 *
 * <p>DOGFOOD-STABILIZATION-02 audit (ADR-0006 §7): the object cleanup obeys a
 * strict anti-race order —
 * <ol>
 *   <li>persist the deletion intent FIRST (fresh owner transaction) so new
 *       exports (controller refuses) and new seals (worker refuses) are
 *       blocked from this point on;</li>
 *   <li>cancel in-flight provider invocations and record the signals;</li>
 *   <li>remove EVERY bucket object the owner still points at — the worklist
 *       is re-listed in a loop until it comes back empty (one pass sees at
 *       most the SQL LIMIT 500), with a no-progress guard so a persistently
 *       unclearable pointer aborts instead of looping;</li>
 *   <li>re-check the worklist once more right before the caller's account
 *       cascade destroys the rows — any pointer that (re)appeared aborts the
 *       deletion.</li>
 * </ol>
 * Pointers existing while no object storage is wired is itself a blocked
 * state (fail-closed): the cascade would destroy the only record of objects
 * the deployment can no longer address. Any object-deletion failure aborts
 * the whole account deletion (the caller surfaces the existing
 * non-disclosing error and a P1 fires): losing the pointer while the object
 * lives is exactly the forbidden outcome. The flow is retry-safe — MinIO
 * deletes are idempotent, so a retried deletion after a database failure
 * finds the objects already gone and proceeds.</p>
 */
public final class AccountDeletionCoordinator {

    /** P1 when an owner's export object blocks the account deletion. */
    public static final String ALERT_OBJECT_BLOCKED =
            "ACCOUNT_DELETE_EXPORT_OBJECT_FAILED";

    /** Hard cap on cleanup passes (500 rows per pass is already generous). */
    static final int MAX_CLEANUP_PASSES = 1000;

    private static final Logger log =
            LoggerFactory.getLogger(AccountDeletionCoordinator.class);

    private final OwnerContext ownerContext;
    private final AccountDeletionIntentService intents;
    private final ObjectProvider<ActiveInvocationRegistry> activeInvocations;
    private final ObjectProvider<ExportObjectStorage> objectStorage;
    private final ObjectProvider<ExportService> exportService;
    private final AlertNotifier alertNotifier;

    public AccountDeletionCoordinator(
            OwnerContext ownerContext,
            AccountDeletionIntentService intents,
            ObjectProvider<ActiveInvocationRegistry> activeInvocations) {
        this(ownerContext, intents, activeInvocations, null, null, null);
    }

    public AccountDeletionCoordinator(
            OwnerContext ownerContext,
            AccountDeletionIntentService intents,
            ObjectProvider<ActiveInvocationRegistry> activeInvocations,
            ObjectProvider<ExportObjectStorage> objectStorage,
            ObjectProvider<ExportService> exportService,
            AlertNotifier alertNotifier) {
        this.ownerContext = Objects.requireNonNull(ownerContext, "ownerContext must not be null");
        this.intents = Objects.requireNonNull(intents, "intents must not be null");
        this.activeInvocations = Objects.requireNonNull(
                activeInvocations, "activeInvocations must not be null");
        this.objectStorage = objectStorage;
        this.exportService = exportService;
        this.alertNotifier = alertNotifier;
    }

    public int prepare(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        // (1) intent first — blocks new exports/seals before anything else.
        AtomicBoolean requested = new AtomicBoolean();
        ownerContext.asOwnerRequiresNew(
                ownerUserId,
                () -> requested.set(intents.requestCurrent(ownerUserId)));
        if (!requested.get()) {
            throw new IllegalStateException("account deletion intent was not accepted");
        }
        // (2) cancel in-flight work, then persist the signal count.
        ActiveInvocationRegistry registry = activeInvocations.getIfAvailable();
        int signalled = registry == null ? 0 : registry.cancelOwner(ownerUserId);
        ownerContext.asOwnerRequiresNew(
                ownerUserId,
                () -> intents.recordCancelSignalsCurrent(ownerUserId, signalled));
        // (3) + (4) full object cleanup and the pre-cascade re-check.
        removeExportObjects(ownerUserId);
        return signalled;
    }

    /**
     * Delete every export bucket object the owner still points at, looping
     * until the worklist is empty, then re-check once more before the caller's
     * account cascade drops the rows. A deletion failure aborts the account
     * deletion (never lose the pointer while the object lives); a
     * pointer-clear failure after a successful object delete is retried by
     * the loop and aborts only when no row makes progress in a whole pass.
     */
    private void removeExportObjects(long ownerUserId) {
        ExportService exports = exportService == null ? null : exportService.getIfAvailable();
        if (exports == null) {
            return;
        }
        ExportObjectStorage storage =
                objectStorage == null ? null : objectStorage.getIfAvailable();
        for (int pass = 1; pass <= MAX_CLEANUP_PASSES; pass++) {
            List<ExportService.ExpiredExportObject> pointers = listPointers(ownerUserId, exports);
            if (pointers.isEmpty()) {
                break;
            }
            if (storage == null) {
                // Fail-closed: pointer rows exist but this deployment cannot
                // address the bucket — the cascade must not destroy them.
                abortNoStorage(ownerUserId, pointers.size());
            }
            int cleared = 0;
            for (ExportService.ExpiredExportObject pointer : pointers) {
                try {
                    storage.delete(pointer.objectKey());
                } catch (RuntimeException e) {
                    log.error(
                            "owner export object deletion failed; account deletion aborted "
                                    + "(exportId={})",
                            pointer.exportId(),
                            e);
                    alertBlocked(
                            "an export object could not be deleted before account deletion; "
                                    + "the deletion was aborted; retry after the object store "
                                    + "recovers");
                    throw new IllegalStateException(
                            "export object cleanup failed; account deletion aborted");
                }
                try {
                    ownerContext.asOwnerRequiresNew(ownerUserId, () -> exports.clearObject(
                            pointer.ownerUserId(), pointer.exportId(), pointer.objectKey()));
                    cleared++;
                } catch (RuntimeException e) {
                    // Object already gone; the row must still clear on a later
                    // pass or the no-progress guard aborts the deletion.
                    log.warn(
                            "export object pointer clear failed after deletion (exportId={}); "
                                    + "retrying on the next pass",
                            pointer.exportId(),
                            e);
                }
            }
            if (cleared == 0) {
                alertBlocked(
                        "no export pointer could be cleared during account deletion cleanup; "
                                + "the deletion was aborted");
                throw new IllegalStateException(
                        "export pointer cleanup made no progress; account deletion aborted");
            }
        }
        // (4) final pre-cascade re-check: a late seal that slipped between
        // the intent check and now must abort here, not orphan behind the
        // cascade.
        List<ExportService.ExpiredExportObject> remaining = listPointers(ownerUserId, exports);
        if (!remaining.isEmpty()) {
            alertBlocked(
                    "an export object pointer reappeared after account-deletion cleanup; "
                            + "the deletion was aborted");
            throw new IllegalStateException(
                    "export object cleanup was not stable; account deletion aborted");
        }
    }

    private List<ExportService.ExpiredExportObject> listPointers(
            long ownerUserId, ExportService exports) {
        AtomicReference<List<ExportService.ExpiredExportObject>> pointers = new AtomicReference<>();
        ownerContext.asOwner(ownerUserId,
                () -> pointers.set(exports.listOwnerObjects(ownerUserId)));
        return pointers.get();
    }

    private void abortNoStorage(long ownerUserId, int pointerCount) {
        log.error(
                "owner {} still has {} export object pointer(s) but no object storage is "
                        + "wired; account deletion aborted",
                ownerUserId,
                pointerCount);
        alertBlocked(
                "export object pointers exist but object storage is not wired; the account "
                        + "deletion was aborted; wire the store or clear the objects first");
        throw new IllegalStateException(
                "export object pointers exist without object storage; account deletion "
                        + "aborted");
    }

    private void alertBlocked(String message) {
        if (alertNotifier != null) {
            alertNotifier.alert(AlertSeverity.P1, ALERT_OBJECT_BLOCKED, message);
        }
    }
}
