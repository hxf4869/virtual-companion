package com.virtualcompanion.runtime.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * DOGFOOD-STABILIZATION-05/06: the fenced upload-intent reconciliation sweep.
 * The 04-round sweep acted on a plain listing; these tests pin the protocol:
 * the atomic claim (which re-validates the live lease against the configured
 * grace) gates every object delete, a lost claim skips the object, the
 * CLAIMED tombstone re-sweep finally reclaims a put that landed AFTER the
 * first sweep (timeline A) and then RETIRES the row once provably safe (06),
 * two scheduler instances never both reclaim one attempt (timeline E), and
 * the prefix audit deletes only objects with no database record at all — one
 * cursor-advancing bounded page per pass.
 */
class ExportUploadReconciliationSchedulerTest {

    private record Alert(AlertSeverity severity, String code, String message) {
    }

    private ExportService exportService;
    private CountingStorage storage;
    private List<Alert> alertLog;
    private ExportUploadReconciliationScheduler scheduler;

    /**
     * Minimal fake bucket with REAL pagination semantics: map, per-key delete
     * failures/counters and a {@code listPage} that sorts, filters past the
     * cursor and truncates at the limit — the bounded-page contract the audit
     * relies on.
     */
    private static final class CountingStorage implements ExportObjectStorage {
        final Map<String, byte[]> objects = new HashMap<>();
        final Map<String, AtomicInteger> deleteCounts = new HashMap<>();
        String failDeleteKey;
        RuntimeException listFailure;

        @Override
        public void put(String key, byte[] bytes) {
            objects.put(key, bytes);
        }

        @Override
        public byte[] get(String key) {
            byte[] bytes = objects.get(key);
            if (bytes == null) {
                throw new IllegalStateException("missing object " + key);
            }
            return bytes;
        }

        @Override
        public void delete(String key) {
            deleteCounts.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet();
            if (key.equals(failDeleteKey)) {
                throw new IllegalStateException("delete failed");
            }
            objects.remove(key);
        }

        @Override
        public List<String> list(String prefix) {
            return listPage(prefix, null, 1000).keys();
        }

        @Override
        public ObjectListing listPage(String prefix, String startAfter, int limit) {
            if (listFailure != null) {
                throw listFailure;
            }
            List<String> page = objects.keySet().stream()
                    .filter(key -> key.startsWith(prefix))
                    .filter(key -> startAfter == null || startAfter.isBlank()
                            || key.compareTo(startAfter) > 0)
                    .sorted()
                    .limit(limit)
                    .toList();
            String nextCursor = page.size() < limit ? null : page.get(page.size() - 1);
            return new ObjectListing(page, nextCursor);
        }

        int deletesOf(String key) {
            AtomicInteger count = deleteCounts.get(key);
            return count == null ? 0 : count.get();
        }
    }

    private static ExportService.StaleUploadIntent intent(
            long id, long owner, long exportId, String key) {
        return new ExportService.StaleUploadIntent(id, owner, exportId, key);
    }

    @BeforeEach
    void setUp() {
        exportService = Mockito.mock(ExportService.class);
        storage = new CountingStorage();
        alertLog = new ArrayList<>();
        AlertNotifier alerts = (severity, code, message) -> alertLog.add(
                new Alert(severity, code, message));
        scheduler = new ExportUploadReconciliationScheduler(
                exportService, storage, alerts, 0L);
        // The audit phase treats "a row exists" as the default (any pointer or
        // intent row keeps the object); the reclaim fence defaults to "held"
        // with an uneventful release. Audit-specific tests override these.
        // retireUploadTombstone defaults to 0 (row not yet safe to retire).
        when(exportService.objectHasRecord(anyString())).thenReturn(true);
        when(exportService.fenceOrphanReclaim(anyString())).thenReturn(true);
        when(exportService.clearOrphanReclaim(anyString())).thenReturn(0);
        when(exportService.retireUploadTombstone(anyLong(), anyLong(), anyInt()))
                .thenReturn(0);
    }

    @Test
    void timelineA_sweepBeforePutThenCrashLeavesNoOrphan() {
        // A: record → grace expired → the sweep runs BEFORE the worker's put
        // (deleting an absent object is a no-op) → the worker puts and crashes
        // → the tombstone re-sweep finally reclaims the object.
        ExportService.StaleUploadIntent row =
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json");
        when(exportService.staleUploadIntents(anyInt(), anyInt()))
                .thenReturn(List.of(row))
                .thenReturn(List.of());
        when(exportService.claimUploadIntent(eq(1L), eq(501L), anyInt()))
                .thenReturn(Optional.of("exports/1/9-aaaa.json"));
        when(exportService.claimedUploadIntents(anyInt(), anyInt()))
                .thenReturn(List.of())
                .thenReturn(List.of(row));

        // Sweep #1: the claim wins, the (still absent) object delete is a
        // no-op, the row becomes a CLAIMED tombstone.
        assertThat(scheduler.runOnce()).isZero();
        assertThat(storage.objects).isEmpty();

        // The delayed worker puts and crashes — no pointer, no seal, ever.
        storage.objects.put("exports/1/9-aaaa.json", new byte[] {1});

        // Sweep #2 (past the re-sweep age): the tombstone re-deletes the late
        // object and, not yet safe to retire, marks itself swept — no orphan
        // remains.
        assertThat(scheduler.runOnce()).isZero();
        assertThat(storage.objects).isEmpty();
        assertThat(storage.deletesOf("exports/1/9-aaaa.json")).isEqualTo(2);
        verify(exportService).markUploadIntentSwept(1L, 501L);
        assertThat(alertLog).isEmpty();
    }

    @Test
    void aLostClaimNeverTouchesTheObject() {
        // Invariant 1 from the Java side: a stale listing entry whose claim
        // was lost (seal consumed it, another instance claimed it, a pointer
        // appeared, OR — 06 — a renew/re-record pushed the live lease out
        // after the listing) must not lead to any object deletion.
        storage.objects.put("exports/1/9-aaaa.json", new byte[] {1});
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of(
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json")));
        when(exportService.claimUploadIntent(eq(1L), eq(501L), anyInt()))
                .thenReturn(Optional.empty());

        assertThat(scheduler.runOnce()).isZero();

        assertThat(storage.objects).containsKey("exports/1/9-aaaa.json");
        assertThat(storage.deletesOf("exports/1/9-aaaa.json")).isZero();
        verify(exportService, never()).markUploadIntentSwept(anyLong(), anyLong());
    }

    @Test
    void timelineE_twoConcurrentSchedulersOnlyOneReclaims() throws Exception {
        // Two scheduler instances race for the same intent; the atomic claim
        // (simulated by a compare-and-set exactly like the single-row UPDATE)
        // lets exactly one of them delete the object.
        storage.objects.put("exports/1/9-aaaa.json", new byte[] {1});
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of(
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json")));
        AtomicReference<String> claimWinner = new AtomicReference<>();
        when(exportService.claimUploadIntent(eq(1L), eq(501L), anyInt())).thenAnswer(
                invocation -> Optional.ofNullable(
                        claimWinner.compareAndSet(null, "exports/1/9-aaaa.json")
                                ? "exports/1/9-aaaa.json" : null));

        CountDownLatch start = new CountDownLatch(1);
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            Thread worker = new Thread(() -> {
                try {
                    start.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
                scheduler.runOnce();
            }, "scheduler-" + i);
            worker.start();
            threads.add(worker);
        }
        start.countDown();
        for (Thread worker : threads) {
            worker.join(10_000);
            assertThat(worker.isAlive()).isFalse();
        }

        // Exactly one delete happened; the loser never touched the object
        // beyond its failed claim.
        assertThat(storage.deletesOf("exports/1/9-aaaa.json")).isEqualTo(1);
        assertThat(storage.objects).doesNotContainKey("exports/1/9-aaaa.json");
    }

    @Test
    void aFailedObjectDeleteAlertsWithoutSecretsAndRetriesOnTheNextCadence() {
        storage.objects.put("exports/1/9-aaaa.json", new byte[] {1});
        storage.failDeleteKey = "exports/1/9-aaaa.json";
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of(
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json")));
        when(exportService.claimUploadIntent(eq(1L), eq(501L), anyInt()))
                .thenReturn(Optional.of("exports/1/9-aaaa.json"));

        scheduler.reconcileAbandonedUploads();
        // The claim already committed, so the row is a CLAIMED tombstone: the
        // re-sweep retries the object delete on a later cadence — no
        // premature retirement, and the P1 carries fixed text only (no key,
        // no fence digest, no content).
        verify(exportService, never()).markUploadIntentSwept(anyLong(), anyLong());
        assertThat(alertLog).hasSize(1);
        Alert alert = alertLog.get(0);
        assertThat(alert.severity()).isEqualTo(AlertSeverity.P1);
        assertThat(alert.code()).isEqualTo(
                ExportUploadReconciliationScheduler.ALERT_ORPHAN_RISK);
        assertThat(alert.message()).doesNotContain("9-aaaa");

        // Reentrant: once the store recovers, the tombstone re-sweep reclaims.
        storage.failDeleteKey = null;
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.claimedUploadIntents(anyInt(), anyInt())).thenReturn(List.of(
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json")));
        scheduler.reconcileAbandonedUploads();
        assertThat(storage.objects).isEmpty();
        verify(exportService).markUploadIntentSwept(1L, 501L);
        assertThat(alertLog).hasSize(1);
    }

    @Test
    void aTombstoneIsRetiredAfterItsFinalSweepWhenSafe() {
        // 06: once the claim window is past every legal late put, the export
        // is terminal and no pointer references the key, the final re-sweep
        // deletes the object AND retires the row — no daily re-sweep forever.
        storage.objects.put("exports/1/9-aaaa.json", new byte[] {1});
        when(exportService.claimedUploadIntents(anyInt(), anyInt())).thenReturn(List.of(
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json")));
        when(exportService.retireUploadTombstone(eq(1L), eq(501L), anyInt()))
                .thenReturn(1);

        assertThat(scheduler.runOnce()).isZero();

        assertThat(storage.objects).isEmpty();
        verify(exportService).retireUploadTombstone(eq(1L), eq(501L), eq(0));
        // Retired: no swept bookkeeping remains for the next cadence.
        verify(exportService, never()).markUploadIntentSwept(anyLong(), anyLong());
    }

    @Test
    void thePrefixAuditDeletesOnlyUnrecordedObjects() {
        // Timeline D's convergence end: after an account-deletion cascade a
        // late worker's object has NO database record at all — the audit is
        // what removes it; every recorded object (pointer or intent row)
        // stays untouched.
        storage.objects.put("exports/2/7-recorded.json", new byte[] {1});
        storage.objects.put("exports/2/8-orphan.json", new byte[] {2});
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.claimedUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.objectHasRecord(anyString())).thenReturn(false);
        when(exportService.objectHasRecord("exports/2/7-recorded.json")).thenReturn(true);

        assertThat(scheduler.runOnce()).isZero();

        assertThat(storage.objects).containsOnlyKeys("exports/2/7-recorded.json");
        assertThat(storage.deletesOf("exports/2/8-orphan.json")).isEqualTo(1);
        // The deletion was gated by the durable reclaim fence and released.
        verify(exportService).fenceOrphanReclaim("exports/2/8-orphan.json");
        verify(exportService).clearOrphanReclaim("exports/2/8-orphan.json");
        verify(exportService, never()).fenceOrphanReclaim("exports/2/7-recorded.json");
    }

    @Test
    void aLostReclaimFenceNeverDeletesTheObject() {
        // 07 (defect D): a WRITER (live upload) holding the key's fence —
        // or another audit pass mid-delete — makes the audit's fence LOSE,
        // and the object is not the audit's to touch, even though the
        // pre-filter saw no record.
        storage.objects.put("exports/2/8-live-writer.json", new byte[] {1});
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.claimedUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.objectHasRecord(anyString())).thenReturn(false);
        when(exportService.fenceOrphanReclaim(anyString())).thenReturn(false);

        assertThat(scheduler.runOnce()).isZero();

        assertThat(storage.objects).containsKey("exports/2/8-live-writer.json");
        assertThat(storage.deletesOf("exports/2/8-live-writer.json")).isZero();
        verify(exportService, never()).clearOrphanReclaim(anyString());
    }

    @Test
    void thePrefixAuditIsBoundedToOnePageAndAdvancesViaTheCursor() {
        // 06: scanning normal objects counts towards the audit bound. With
        // more keys under the prefix than MAX_AUDIT_PER_RUN, one pass only
        // touches the first page (recorded keys included); the orphan just
        // past the page boundary is only reclaimed by the NEXT pass, which
        // resumes strictly after the stored cursor — never by loading the
        // whole prefix at once.
        int bound = ExportUploadReconciliationScheduler.MAX_AUDIT_PER_RUN;
        for (int i = 0; i < bound; i++) {
            // Recorded filler fills the first page entirely.
            storage.objects.put("exports/2/filler-" + String.format("%05d", i) + ".json",
                    new byte[] {1});
        }
        String orphanPastTheBoundary = "exports/2/zz-orphan.json";
        storage.objects.put(orphanPastTheBoundary, new byte[] {2});
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.claimedUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        when(exportService.objectHasRecord(anyString())).thenReturn(false);

        // Pass 1: the page is full of recorded filler — the boundary orphan
        // is NOT scanned (a full-bucket load would have caught it: exactly
        // the defect this pins as impossible).
        assertThat(scheduler.runOnce()).isZero();
        assertThat(storage.objects).containsKey(orphanPastTheBoundary);
        assertThat(storage.deletesOf(orphanPastTheBoundary)).isZero();

        // Pass 2: the cursor resumes after the last scanned key; the orphan
        // (no database record) is reclaimed, and the exhausted page resets
        // the cursor for the next full-prefix walk.
        assertThat(scheduler.runOnce()).isZero();
        assertThat(storage.objects).doesNotContainKey(orphanPastTheBoundary);
        assertThat(storage.deletesOf(orphanPastTheBoundary)).isEqualTo(1);
    }

    @Test
    void aFailingPrefixAuditCountsAsFailure() {
        storage.listFailure = new IllegalStateException("bucket down");
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        assertThat(scheduler.runOnce()).isEqualTo(1);
    }

    @Test
    void anEmptyWorklistIsANoOp() {
        when(exportService.staleUploadIntents(anyInt(), anyInt()))
                .thenReturn(List.of());
        assertThat(scheduler.runOnce()).isZero();
        verify(exportService, never()).markUploadIntentSwept(anyLong(), anyLong());
    }

    @Test
    void negativeGraceIsRejected() {
        assertThrows(IllegalArgumentException.class, () ->
                new ExportUploadReconciliationScheduler(
                        exportService, storage,
                        (severity, code, message) ->
                                alertLog.add(new Alert(severity, code, message)),
                        -1L));
    }

    @Test
    void theWorklistQueriesCarryTheConfiguredGraceAndBound() {
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of());
        AlertNotifier alerts = (severity, code, message) ->
                alertLog.add(new Alert(severity, code, message));
        ExportUploadReconciliationScheduler oneMinute =
                new ExportUploadReconciliationScheduler(
                        exportService, storage, alerts, 60_000L);
        oneMinute.runOnce();
        verify(exportService).staleUploadIntents(
                eq(ExportUploadReconciliationScheduler.MAX_PER_RUN), eq(60));
        verify(exportService).claimedUploadIntents(
                eq(ExportUploadReconciliationScheduler.MAX_PER_RUN), eq(60));
    }

    @Test
    void theClaimCarriesTheConfiguredGraceForLeaseRevalidation() {
        // 06 (defect I, Java side): the scheduler must pass its grace into
        // claimUploadIntent — the SQL claim re-validates the live lease
        // against exactly this value inside the atomic UPDATE.
        ExportService.StaleUploadIntent row =
                intent(501L, 1L, 9L, "exports/1/9-aaaa.json");
        when(exportService.staleUploadIntents(anyInt(), anyInt())).thenReturn(List.of(row));
        when(exportService.claimUploadIntent(eq(1L), eq(501L), eq(600)))
                .thenReturn(Optional.empty());
        AlertNotifier alerts = (severity, code, message) ->
                alertLog.add(new Alert(severity, code, message));
        new ExportUploadReconciliationScheduler(exportService, storage, alerts, 600_000L)
                .runOnce();
        verify(exportService).claimUploadIntent(eq(1L), eq(501L), eq(600));
    }
}
