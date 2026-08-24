package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * METRICS-ALERT (§26.6): the scheduler refreshes {@code vc_beta_dau} from the
 * V77 job SD with the service-window zone's day start, and a failed poll must
 * never propagate (the gauge keeps its last value until the next pass).
 */
class DauMetricsSchedulerTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final VcMetrics metrics = new VcMetrics(registry);
    private final BetaServiceWindow window =
            new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai");

    @Test
    void refreshesTheGaugeFromTheJobSd() {
        when(jdbc.queryForObject(anyString(), any(Class.class), any(Timestamp.class)))
                .thenReturn(7L);

        new DauMetricsScheduler(jdbc, metrics, window).pollDailyActiveUsers();

        assertThat(registry.get("vc_beta_dau").gauge().value()).isEqualTo(7.0);
    }

    @Test
    void nullCountReadsAsZero() {
        when(jdbc.queryForObject(anyString(), any(Class.class), any(Timestamp.class)))
                .thenReturn(null);

        new DauMetricsScheduler(jdbc, metrics, window).pollDailyActiveUsers();

        assertThat(registry.get("vc_beta_dau").gauge().value()).isEqualTo(0.0);
    }

    @Test
    void failedPollKeepsThePreviousValueWithoutPropagating() {
        List<String> alerts = new ArrayList<>();
        DauMetricsScheduler scheduler = new DauMetricsScheduler(
                jdbc, metrics, window, null,
                (severity, code, message) -> alerts.add(severity + ":" + code + ":" + message));
        when(jdbc.queryForObject(anyString(), any(Class.class), any(Timestamp.class)))
                .thenReturn(5L);
        scheduler.pollDailyActiveUsers();
        when(jdbc.queryForObject(anyString(), any(Class.class), any(Timestamp.class)))
                .thenThrow(new IllegalStateException("db down"));

        scheduler.pollDailyActiveUsers();

        assertThat(registry.get("vc_beta_dau").gauge().value()).isEqualTo(5.0);
        assertThat(alerts).containsExactly(
                "P1:DAU_METRICS_FAILED:daily active user aggregate refresh failed");
    }
}
