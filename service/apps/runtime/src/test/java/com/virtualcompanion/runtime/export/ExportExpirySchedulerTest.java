package com.virtualcompanion.runtime.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.JobLease;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import org.junit.jupiter.api.Test;

class ExportExpirySchedulerTest {

    /** Minimal in-memory fake storage with a deletable failure switch. */
    private static final class FakeStorage implements ExportObjectStorage {
        final Map<String, byte[]> objects = new HashMap<>();
        boolean failDeletes;

        @Override
        public void put(String key, byte[] bytes) {
            objects.put(key, bytes);
        }

        @Override
        public byte[] get(String key) {
            return objects.get(key);
        }

        @Override
        public void delete(String key) {
            if (failDeletes) {
                throw new IllegalStateException("delete failed");
            }
            objects.remove(key);
        }

        @Override
        public java.util.List<String> list(String prefix) {
            return objects.keySet().stream()
                    .filter(key -> key.startsWith(prefix))
                    .sorted()
                    .collect(java.util.stream.Collectors.toList());
        }

        @Override
        public ExportObjectStorage.ObjectListing listPage(
                String prefix, String startAfter, int limit) {
            return new ExportObjectStorage.ObjectListing(list(prefix), null);
        }
    }

    @Test
    void lostLeaseDoesNotSweep() {
        ExportService exports = mock(ExportService.class);
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusive(eq(JobLease.EXPORT_EXPIRY), any(), eq(60)))
                .thenReturn(OptionalLong.empty());

        new ExportExpiryScheduler(exports, lease).sweepExpiredExports();

        verify(exports, never()).expireStale();
    }

    @Test
    void failedSweepRecordsFixedP1AlertWithoutUserContent() {
        ExportService exports = mock(ExportService.class);
        when(exports.expireStale()).thenThrow(new IllegalStateException("payload text must not escape"));
        List<String> alerts = new ArrayList<>();

        new ExportExpiryScheduler(
                exports, null,
                (severity, code, message) -> alerts.add(severity + ":" + code + ":" + message))
                .sweepExpiredExports();

        assertThat(alerts).containsExactly(
                "P1:EXPORT_EXPIRY_FAILED:data export expiry sweep failed");
        assertThat(alerts.getFirst()).doesNotContain("payload text must not escape");
    }

    @Test
    void objectModeSweepDeletesExpiredObjectsAndClearsThePointers() {
        ExportService exports = mock(ExportService.class);
        when(exports.listExpiredObjects()).thenReturn(List.of(
                new ExportService.ExpiredExportObject(1L, 9L, "exports/1/9.json"),
                new ExportService.ExpiredExportObject(2L, 11L, "exports/2/11.json")));
        FakeStorage storage = new FakeStorage();
        storage.objects.put("exports/1/9.json", new byte[] {1});
        storage.objects.put("exports/2/11.json", new byte[] {2});

        new ExportExpiryScheduler(exports, null, null, storage).sweepExpiredExports();

        assertThat(storage.objects).isEmpty();
        verify(exports).clearObject(1L, 9L, "exports/1/9.json");
        verify(exports).clearObject(2L, 11L, "exports/2/11.json");
    }

    @Test
    void objectModeDeleteFailureAlertsP1AndKeepsTheRowForRetry() {
        ExportService exports = mock(ExportService.class);
        when(exports.listExpiredObjects()).thenReturn(List.of(
                new ExportService.ExpiredExportObject(1L, 9L, "exports/1/9.json")));
        FakeStorage storage = new FakeStorage();
        storage.objects.put("exports/1/9.json", new byte[] {1});
        storage.failDeletes = true;
        List<String> alerts = new ArrayList<>();

        new ExportExpiryScheduler(
                exports, null,
                (severity, code, message) -> alerts.add(severity + ":" + code + ":" + message),
                storage)
                .sweepExpiredExports();

        assertThat(alerts).containsExactly(
                "P1:" + ExportExpiryScheduler.ALERT_OBJECT_DELETE_FAILED
                        + ":export object deletion failed; sweep will retry");
        // The pointer is NOT cleared: the next cadence re-lists and retries.
        verify(exports, never()).clearObject(anyLong(), anyLong(), any());
        assertThat(storage.objects).containsKey("exports/1/9.json");
    }

    @Test
    void inlineModeSweepNeverQueriesTheObjectWorklist() {
        ExportService exports = mock(ExportService.class);

        new ExportExpiryScheduler(exports, null, null, null).sweepExpiredExports();

        verify(exports, never()).listExpiredObjects();
        verify(exports, never()).listFailedObjects();
        verify(exports, never()).clearObject(anyLong(), anyLong(), any());
    }

    @Test
    void sweepAlsoDeletesObjectsBehindFailedRows() {
        // DOGFOOD-STABILIZATION: the FAILED-with-pointer rows kept by the
        // worker's no-orphan protocol are swept too.
        ExportService exports = mock(ExportService.class);
        when(exports.listExpiredObjects()).thenReturn(List.of());
        when(exports.listFailedObjects()).thenReturn(List.of(
                new ExportService.ExpiredExportObject(3L, 21L, "exports/3/21.json")));
        FakeStorage storage = new FakeStorage();
        storage.objects.put("exports/3/21.json", new byte[] {3});

        new ExportExpiryScheduler(exports, null, null, storage).sweepExpiredExports();

        assertThat(storage.objects).isEmpty();
        verify(exports).clearObject(3L, 21L, "exports/3/21.json");
    }

    @Test
    void deleteFailureRecordsAFailedJobRunNotSucceeded() {
        // DOGFOOD-STABILIZATION audit: a run with failed object deletions
        // must not report SUCCEEDED.
        ExportService exports = mock(ExportService.class);
        when(exports.listExpiredObjects()).thenReturn(List.of(
                new ExportService.ExpiredExportObject(1L, 9L, "exports/1/9.json")));
        when(exports.listFailedObjects()).thenReturn(List.of());
        FakeStorage storage = new FakeStorage();
        storage.objects.put("exports/1/9.json", new byte[] {1});
        storage.failDeletes = true;
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusive(eq(JobLease.EXPORT_EXPIRY), any(), eq(60)))
                .thenReturn(OptionalLong.of(7L));

        new ExportExpiryScheduler(exports, lease, null, storage).sweepExpiredExports();

        verify(lease).finishRun(
                eq(7L), eq("FAILED"), org.mockito.ArgumentMatchers.contains("objectDeleteFailures"),
                eq("object_delete_failed"));
    }

    @Test
    void cleanRunStillRecordsSucceeded() {
        ExportService exports = mock(ExportService.class);
        when(exports.listExpiredObjects()).thenReturn(List.of(
                new ExportService.ExpiredExportObject(1L, 9L, "exports/1/9.json")));
        when(exports.listFailedObjects()).thenReturn(List.of());
        FakeStorage storage = new FakeStorage();
        storage.objects.put("exports/1/9.json", new byte[] {1});
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusive(eq(JobLease.EXPORT_EXPIRY), any(), eq(60)))
                .thenReturn(OptionalLong.of(8L));

        new ExportExpiryScheduler(exports, lease, null, storage).sweepExpiredExports();

        verify(lease).finishRun(
                eq(8L), eq("SUCCEEDED"), org.mockito.ArgumentMatchers.contains("expired"),
                eq(""));
    }
}
