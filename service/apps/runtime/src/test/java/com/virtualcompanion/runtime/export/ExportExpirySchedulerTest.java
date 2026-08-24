package com.virtualcompanion.runtime.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.JobLease;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalLong;
import org.junit.jupiter.api.Test;

class ExportExpirySchedulerTest {

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
}
